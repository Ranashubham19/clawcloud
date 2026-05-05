# Public WhatsApp Launch

The backend can run with Meta's test phone number, but the public launch needs a production WhatsApp number and a non-temporary access token.

## Current test mode

- Meta test numbers can only message approved recipient numbers.
- A temporary user access token can expire and should not be used for a public bot.
- `WHATSAPP_APP_SECRET` should be set before public traffic so webhook signatures are validated.

## Public launch steps

1. In Meta Business Settings, open `Accounts > WhatsApp accounts`.
2. Select the `Claw Cloud` WhatsApp Business Account.
3. Open `Phone numbers`.
4. Add or migrate the production WhatsApp number.
5. Copy the production phone number ID into `WHATSAPP_PHONE_NUMBER_ID`.
6. Create a permanent System User token with WhatsApp messaging and management permissions.
7. Put that token in `WHATSAPP_ACCESS_TOKEN`.
8. Copy the app secret into `WHATSAPP_APP_SECRET`.
9. Configure the webhook callback URL:

```text
https://claw-cloud-api-production.up.railway.app/webhooks/whatsapp
```

10. Configure the webhook verify token:

```text
ea17db05608d4226821e6f399a0330d2
```

11. Subscribe to the `messages` webhook field.
12. Run:

```bash
npm run doctor:public
```

13. Share the production phone number or `wa.me` link only after the public check passes.

## Token failure runbook

If Railway logs show `Authentication Error`, `OAuthException`, or Meta code `190`,
the WhatsApp access token is invalid. Temporary user tokens can become invalid
when the Meta user logs out, changes password, or the token expires.

Required fix:

1. Create or open a Meta Business System User.
2. Assign the WhatsApp Business Account and phone number asset to that System User.
3. Generate a new token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
4. Replace `WHATSAPP_ACCESS_TOKEN` in Railway, then restart/redeploy the service.
5. Run `npm run doctor:meta` or `npm run doctor:public` before testing inbound
   messages again.
