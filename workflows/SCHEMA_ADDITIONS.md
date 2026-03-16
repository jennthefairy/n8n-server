# Schema Additions — Campaign Lifecycle Agent

## Required Fields (must exist before workflows run)

### ORDERS table — `last_state_change` (DateTime)

| Field | Type | Required by |
|-------|------|-------------|
| `last_state_change` | DateTime | `watchdog.json` — stuck-order query uses `DATETIME_DIFF(NOW(), {last_state_change}, 'hours') > 24` |

**Why:** The watchdog identifies stuck orders by comparing `last_state_change` to NOW(). Without this field the formula always returns 0 and no orders are flagged.

**Set by:** `campaign-autoclose.json` sets `last_state_change = $now.toISO()` on every ORDERS write (captured, released, error states).

**Coordinate with:** `feature/airtable-schema` agent — this field must be added to the ORDERS table schema and included in the Airtable base setup script before the watchdog workflow is enabled.

---

## Fields written by campaign-autoclose.json

### ORDERS

| Field | Values written | When |
|-------|---------------|------|
| `capture_status` | `captured` / `cancelled` | After successful Stripe capture / cancel |
| `state` | `Paid` / `Released` / `Error` | After Stripe success / success / error |
| `workflow_name` | `campaign_autoclose_success` / `campaign_autoclose_failed` / `campaign_autoclose_capture_error` / `campaign_autoclose_cancel_error` | On each state change |
| `last_state_change` | ISO datetime | On every ORDERS write |

### CAMPAIGNS

| Field | Values written | When |
|-------|---------------|------|
| `status` | `successful` / `failed` | After all orders in campaign are processed |

### AUDIT_LOGS

| Field | Values written | Notes |
|-------|---------------|-------|
| `actor` | `campaign_autoclose` | All entries from this workflow |
| `action` | `campaign_closed_success` / `campaign_closed_failed` / `stripe_capture_error` / `stripe_cancel_error` / `invalid_transition_attempted` | |
| `target_type` | `campaigns` / `orders` | |
| `target_id` | Airtable record ID | |
| `details` | JSON string | Error details or transition info |

---

## Fields written by watchdog.json

### ORDERS

| Field | Values written | When |
|-------|---------------|------|
| `workflow_name` | `t120_auto_patience_msg` | After T+120 patience message sent — prevents re-sending |

### AUDIT_LOGS

| Field | Values written | When |
|-------|---------------|------|
| `actor` | `watchdog` | |
| `action` | `watchdog_alert_sent` | After each stuck-order admin alert |
| `target_type` | `orders` | |
| `target_id` | Order record ID | |
| `details` | `{"hours_stuck": N, "state": "..."}` | |

---

## State Transitions (this agent only)

```
Pre-Auth → Paid      (Stripe capture success)    ✅
Pre-Auth → Released  (Stripe cancel success)     ✅
Pre-Auth → Error     (Stripe API error)          ✅ (error state)
```

Any other transition is rejected: AUDIT_LOGS entry written + admin alerted.
