# Security Specification: VaultReceipt Firestore Rules

## 1. Data Invariants
1. Every document in `/users/{userId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`. No other user may read, list, create, update, or delete another user's profile.
2. Every document in `/receipts/{receiptId}` must have `userId == request.auth.uid`, valid 64-char lowercase hex `sha256Hash`, valid ISO `YYYY-MM-DD` `receipt_date`, 3-letter uppercase `currency`, bounded strings, and server-validated `createdAt == request.time` / `updatedAt == request.time`.
3. Cryptographic seal fields (`id`, `userId`, `sha256Hash`, `uploadedAtUtc`, `fileName`, `fileSizeBytes`, `mimeType`, `imageUrl`, `createdAt`) are strictly immutable after document creation. Updates are restricted exclusively to editable accounting metadata (`merchant_name`, `receipt_date`, `currency`, `subtotal`, `gst_amount`, `total_amount`, `category`, `updatedAt`).
4. Every document in `/earnings/{earningId}` belongs strictly to `request.auth.uid`, validates `client_name`, `description`, `earned_date`, `currency`, numeric `amount`/`gst_collected`/`net_revenue`, and enforces server timestamps (`createdAt == request.time`, `updatedAt == request.time`). Immutable `id`, `userId`, `createdAt` cannot be modified after creation.
5. List queries on `/receipts` and `/earnings` are strictly rule-enforced (`resource.data.userId == request.auth.uid`) and `/users` listing is completely denied.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: `auth = null` attempting `getDoc('/receipts/r1')` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', token: { email_verified: false } }` attempting `setDoc('/receipts/r1', ...)` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Ownership Spoof**: `u1` creating `/receipts/r2` with `{ userId: 'u2', ... }` -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field Injection**: `u1` creating `/receipts/r1` with an extra field `{ isAdmin: true }` -> `PERMISSION_DENIED`.
5. **Immutable Hash Tampering on Update**: `u1` updating `/receipts/r1` to change `sha256Hash` -> `PERMISSION_DENIED`.
6. **Immutable UTC Seal Tampering on Update**: `u1` updating `/receipts/r1` to backdate `uploadedAtUtc` or `createdAt` -> `PERMISSION_DENIED`.
7. **Client-Forged Timestamp on Create**: `u1` creating `/receipts/r1` with client string/past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **ID Poisoning Attack**: `u1` targeting `/receipts/invalid!id$with*chars` or >128 chars -> `PERMISSION_DENIED`.
9. **Denial-of-Wallet Large String Injection**: `u1` writing a 10KB string into `merchant_name` (>140 chars) -> `PERMISSION_DENIED`.
10. **Blanket List Query Scraping**: `u1` running `getDocs(collection(db, 'receipts'))` without `where('userId', '==', 'u1')` -> `PERMISSION_DENIED`.
11. **User PII Blanket Read / List**: `u1` attempting `getDoc('/users/u2')` or `getDocs(collection(db, 'users'))` -> `PERMISSION_DENIED`.
12. **Type Poisoning on Update**: `u1` updating `total_amount` to `"100.00"` (string instead of number) -> `PERMISSION_DENIED`.

## 3. Verification Matrix
All 12 adversarial cases above are blocked by `firestore.rules` via:
- Default-deny catch-all `match /{document=**}`
- `isSignedIn() && isVerifiedUser()` gates
- `isValidId()` regex + length guards
- `isValidReceipt()` & `isValidUserVaultProfile()` strict `hasAll` / `hasOnly` + type + `.size()` checks
- `affectedKeys().hasOnly(...)` action-scoped updates + immutability invariants
- `resource.data.userId == request.auth.uid` on `allow list`.
