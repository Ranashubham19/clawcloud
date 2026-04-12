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
