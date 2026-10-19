# Farmmatch Agent ⇄ Register: Data Contract

This is the spec for the agent that moves data between **Farmmatch** and the **Grazin' Acres in-store register**.

The agent has two jobs:

1. **Pull from Farmmatch → register database**: products (with prices) and members/customers (with renewal dates).
2. **Push register sales → Farmmatch**: once a week, enter the in-store sales into Farmmatch, then mark them posted.

The agent never writes to tables directly. It only calls the functions below. Each function validates its input and runs atomically, so a bad payload changes nothing.

---

## Connection

> **Command line:** `node tools/register.mjs --help` does all of the below without hand-built requests. It reads the key from Windows Credential Manager (`node tools/register.mjs key set`).

| | |
|---|---|
| Supabase project | `Grazin Acres Register` (ref `fkjeeeicnxsnmaovsjtk`) |
| API URL | `https://fkjeeeicnxsnmaovsjtk.supabase.co` |
| Key | **service_role / secret key**. Get it from the Supabase dashboard: make sure the project picker at the top says **Grazin Acres Register** (not Constructly), then Project Settings → API Keys. Use the `sb_secret_...` key, or the legacy `service_role` key. **Not** the publishable/anon key. Keep it secret; it bypasses all access rules. Never put it in the register app. |

**Every request needs both headers, with the same key in each.** Leaving out `apikey` gets `401 UNAUTHORIZED_MISSING_API_KEY`. A key from another project, or with a trailing newline, gets `401 UNAUTHORIZED_INVALID_API_KEY`. Strip whitespace from the key when loading it.

To test the key: `SUPABASE_SECRET_KEY=... python scripts/check_connection.py`. It says exactly what's wrong and never prints the key.

**Option A: REST (any agent that can make HTTP calls)**

```
POST https://fkjeeeicnxsnmaovsjtk.supabase.co/rest/v1/rpc/<function_name>
apikey: <service_role key>
Authorization: Bearer <service_role key>
Content-Type: application/json

{ ...named arguments... }
```

Reading a view:

```
GET https://fkjeeeicnxsnmaovsjtk.supabase.co/rest/v1/agent_sales_to_post?select=*
apikey: <service_role key>
Authorization: Bearer <service_role key>
```

**Option B: Claude with the Supabase connector.** Call the same functions with `execute_sql`, e.g. `select public.sync_products('[...]'::jsonb, true);`.

---

## Job 1: Sync products

`sync_products(p_items jsonb, p_full_sync boolean default true, p_dry_run boolean default false, p_allow_shrink boolean default false)`

`p_dry_run => true` validates and reports `new` / `would_hide` without writing. A full sync that would hide more than 20% (min 5) of active rows is **refused** unless `p_allow_shrink => true`, which is the operator's call only. The same applies to `sync_members`.

Send **every product sold in the store** in one call. Include weighed items.

```json
{
  "p_full_sync": true,
  "p_items": [
    { "farmmatch_id": "1042", "name": "Whole Milk, 1 gal", "category": "Dairy",
      "sale_type": "each", "price": 8.50 },
    { "farmmatch_id": "2210", "name": "Ground Beef", "category": "Meat",
      "sale_type": "weight", "unit": "lb", "price": 9.99 }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `farmmatch_id` | yes | Farmmatch's own ID for the product. **Must be stable.** This is how the register maps sales back to Farmmatch. Don't use the name. |
| `name` | yes | As shown on the register button and receipt. |
| `sale_type` | yes | `"each"` (sold by count) or `"weight"` (cashier types the weight). |
| `price` | yes | JSON number in **dollars**. For weight items it's the price **per unit** (per lb). |
| `unit` | no | Defaults to `"ea"` for each, `"lb"` for weight. Use `"oz"`, `"gal"`, etc. if Farmmatch does. |
| `category` | no | Groups buttons on the register (Dairy, Meat, Eggs…). |
| `taxable` | no | Default `false`. |
| `sort_order` | no | Lower numbers show first within a category. Default 0. |

**`p_full_sync`**
- `true` (normal weekly run): the list is complete. Products **not** in the list are hidden from the register. They are not deleted, so old sales keep their history.
- `false`: only add or update the listed products and leave everything else alone. Use this for a quick mid-week price fix.

Returns `{"received": n, "inserted": n, "updated": n, "deactivated": n}`. Sanity-check it. If `deactivated` is large and unexpected, the scrape probably missed a page.

---

## Job 1b: Sync members / customers

`sync_members(p_items jsonb, p_full_sync boolean default true, p_dry_run boolean default false, p_allow_shrink boolean default false)`

Send **every Farmmatch account**, members and non-members alike. Every in-store customer has a Farmmatch account.

```json
{
  "p_full_sync": true,
  "p_items": [
    { "farmmatch_id": "C-881", "first_name": "Jane", "last_name": "Doe",
      "email": "jane@example.com", "phone": "608-555-0101",
      "membership_type": "Annual", "renewal_date": "2027-03-01",
      "has_card_on_file": true }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `farmmatch_id` | yes | Farmmatch's customer/account ID. Must be stable. |
| `first_name` / `last_name` | at least one | |
| `email`, `phone` | no | Phone can be any format. The register searches by digits only. |
| `membership_type` | no | Free text as Farmmatch shows it. |
| `renewal_date` | no | `"YYYY-MM-DD"`. Leave it out or set `null` if the account has no membership. The register works out status from this: **active**, **expiring soon** (within 14 days), **expired**, or **none**. |
| `has_card_on_file` | no | Default `false`. The register warns the cashier before choosing "Card on file" when this is false. |
| `notes` | no | Shown to the cashier on lookup. |

`p_full_sync` works the same as for products. Accounts missing from a full sync are hidden, not deleted.

---

## Job 2: Post weekly sales into Farmmatch

### Step 1: Read what needs posting

Read the view **`agent_sales_to_post`**. Each row is one sale. Rows come back in time order.

| Column | Meaning |
|---|---|
| `sale_id` | Use this when marking it done. |
| `receipt_number` | Printed on the customer's receipt. Put it in the Farmmatch order notes so the two can be matched later. |
| `sold_at` | Timestamp (UTC). |
| `action` | `"post"` = enter this sale. `"reverse"` = this sale was **already posted** and later voided in the store, so cancel or refund it in Farmmatch (see `farmmatch_order_ref`). |
| `ready` | Only process rows where `ready = true`. |
| `blocked_reason` | Why a row isn't ready (see Step 0). |
| `customer_farmmatch_id` | The Farmmatch account to put the order on. |
| `customer_name`, `customer_email`, `customer_phone` | For cross-checking. |
| `tender` | `"cash"`, `"check"`, or `"card_on_file"`. |
| `check_number` | For checks. |
| `subtotal`, `tax`, `total` | Dollars. |
| `membership_fee` | Membership renewal paid at the register, in dollars ($30 by default, or 0). **Included in `total`**, so `total = subtotal + tax + membership_fee - jar_credit`. |
| `jar_returns`, `jar_credit` | Jars returned in store and the credit given, in dollars ($1/jar by default, never more than the order). **`total` is already after the jar credit**, so `total = subtotal + tax - jar_credit`. |
| `lines` | JSON array, one item per line (below). |
| `farmmatch_order_ref` | For `reverse` rows: the order you created when posting. |
| `posting_attempts`, `posting_error` | Previous failures, if any. |

Each item in `lines`:

```json
{ "line_no": 2, "farmmatch_product_id": "2210", "product_name": "Ground Beef",
  "sale_type": "weight", "unit": "lb", "quantity": 1.37,
  "unit_price": 9.99, "line_total": 13.69, "taxable": false }
```

- For `weight` lines, `quantity` is the weight in `unit` (up to 3 decimals).
- `unit_price` is the price **the cashier actually charged**. Use it rather than the current Farmmatch price, because a price may have changed since the sale.
- `line_total` = quantity × unit_price, rounded to the cent.

### Membership renewals
If `membership_fee` > 0, the customer renewed at the register. In FarmMatch, renew that customer's membership (extend the renewal date the same way an online renewal would) and record the fee as part of the order, so the FarmMatch order total matches `total`. Until FarmMatch's renewal date moves forward, the register shows the customer as "Renewed in store" and won't charge them again. Once the next sync brings in the new date, they show as Active.

### Jar returns
If `jar_credit` > 0, the order in FarmMatch must come to the same `total`. Apply the jar credit the same way FarmMatch records jar returns ($1 per jar), noting `jar_returns` jars and the receipt number. Don't post the items at full price and then also issue a separate jar credit, because that credits the customer twice.

### Tender handling in Farmmatch

| `tender` | What the agent does in Farmmatch |
|---|---|
| `cash` | Record the order as **paid (cash)**. Don't charge a card. |
| `check` | Record the order as **paid (check #`check_number`)**. Don't charge a card. |
| `card_on_file` | Create the order and **charge the customer's card on file** for `total`. |

> ⚠️ `card_on_file` sales charge real money. If the charge is declined, don't retry blindly. Call `mark_sale_failed` with the decline message so it's visible to the farm.

### Step 0 (before posting): Link in-store signups

If someone signed up for Farmmatch at the counter, their sale has `ready = false` and a `blocked_reason` that includes a `pending_customer_id`. To unblock it:

1. Make sure the new account has been synced (`sync_members`).
2. Find the account by name/phone/email, then call:

```
link_pending_customer(p_pending_customer_id uuid, p_member_farmmatch_id text)
```

Returns `{"member_id": "...", "sales_linked": n}`. The row then appears as `ready = true`.

If you can't confidently find the account (no match, or more than one), **leave it blocked** and report it to the farm. Don't guess.

### Step 2: Mark each sale

Process sales one at a time and mark each one **immediately** after handling it, so a crash halfway through never double-posts.

Success:
```
mark_sale_posted(p_sale_id uuid, p_farmmatch_order_ref text)
```
`p_farmmatch_order_ref` = the Farmmatch order ID/number you created (or cancelled, for `reverse`). Always pass it if Farmmatch gives you one. It's needed to reverse the sale later.

Failure:
```
mark_sale_failed(p_sale_id uuid, p_error text)
```
The sale stays in the view with the error attached and is retried on the next run.

### Posting lifecycle

```
unposted ──post ok──▶ posted ──voided in store──▶ needs_reversal ──reverse ok──▶ reversed
    │                                                     │
    └──post failed──▶ failed (retried next run)           └──reverse failed──▶ stays needs_reversal

unposted/failed ──voided in store before posting──▶ not_needed (disappears from the view)
```

---

## Weekly run checklist

1. `sync_products` (full) → check the counts.
2. `sync_members` (full) → check the counts.
3. Link any blocked in-store signups (`link_pending_customer`).
4. Read `agent_sales_to_post`. For each `ready` row in order: enter or reverse it in Farmmatch, then `mark_sale_posted` / `mark_sale_failed`.
5. Report back: products/members synced, sales posted, card charges made, failures, and still-blocked signups.

Running the sync more often (e.g. daily) is safe and keeps prices and new signups fresher.
