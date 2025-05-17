# Twilio SMS Sending Issues Investigation

**Date:** 2024-07-26

**Objective:** Diagnose and resolve issues with Twilio SMS sending functionality not working in the production environment, despite previously working and environment variables reportedly being correct.

## 1. Initial Problem Description

Users reported that Twilio SMS (booking confirmations, reminders) stopped working in production. This occurred after recent deployments, even though core Twilio-related environment variables (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`) were confirmed to be unchanged and correctly set in Vercel. The Supabase client in SMS actions was also updated to use `SUPABASE_SERVICE_ROLE_KEY` to match a previously working state, but issues persisted.

## 2. Key Finding: `messagingServiceSid` vs. `from` Phone Number

A code example provided by the user from Twilio's official documentation highlighted a key difference:

*   **Twilio Example:** Uses `messagingServiceSid: 'MGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'`
*   **Application Code (Previous):** Used `from: process.env.TWILIO_PHONE_NUMBER`

### Why this difference is critical:

*   **Messaging Service:** A Twilio Messaging Service is a higher-level construct for managing senders (phone numbers, short codes, Alphanumeric IDs). It's crucial for features like:
    *   A2P 10DLC compliance in the US (associating traffic with registered campaigns).
    *   Managing multiple senders, sender selection logic, and sticky senders.
    *   Improved deliverability and scalability.
*   **Direct `from` Number:** Simpler for basic use but can face more filtering and compliance issues, especially for A2P traffic to regions like the US if not managed correctly through a campaign linked to a Messaging Service.

**Hypothesis:** The production environment or current carrier policies now strictly require or heavily favor the use of a `messagingServiceSid` for reliable A2P SMS delivery. Sending directly with a `from` number might be failing due to filtering, lack of campaign association, or other compliance checks.

## 3. Code Changes Implemented in `src/app/actions/sms.ts`

To address this, the `sendBookingConfirmation` and `sendEventReminders` functions in `src/app/actions/sms.ts` were modified as follows:

1.  **New Environment Variable Expected:** The system now looks for a new optional environment variable: `TWILIO_MESSAGING_SERVICE_SID`.

2.  **Updated Sender Logic:**
    *   The code now prioritizes using `process.env.TWILIO_MESSAGING_SERVICE_SID` if it's available.
    *   If `TWILIO_MESSAGING_SERVICE_SID` is not set, it falls back to using `process.env.TWILIO_PHONE_NUMBER` as the `from` address.
    *   Checks are in place to ensure at least one of these sender identifiers (Messaging Service SID or Phone Number) is configured, along with the Account SID and Auth Token.

3.  **Modified `messages.create` call:**
    ```javascript
    const messageParams = {
      body: message,
      to: recipientPhoneNumber,
    };

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER;
    }
    // ... error handling if neither is present ...

    await twilioClient.messages.create(messageParams);
    ```

4.  **Enhanced Logging:** Logging was added to indicate whether a Messaging Service SID or a `from` number was used for each send attempt, aiding future debugging.

## 4. Action Required by User

1.  **Check Twilio Messaging Service:**
    *   Log in to your Twilio Console.
    *   Navigate to **Messaging > Services**.
    *   If a relevant Messaging Service exists, obtain its **SID (starts with `MG...`)**. This is the service that should contain your sending phone number(s) and be associated with any necessary campaigns (e.g., A2P 10DLC for US traffic).

2.  **Set `TWILIO_MESSAGING_SERVICE_SID` in Vercel:**
    *   In your Vercel project settings, under Environment Variables, add a **new variable** named `TWILIO_MESSAGING_SERVICE_SID`.
    *   Set its value to the SID obtained from your Twilio console.
    *   Ensure this variable is available to the Production environment (and Preview/Development if applicable).

3.  **If `TWILIO_MESSAGING_SERVICE_SID` is set, `TWILIO_PHONE_NUMBER` becomes optional for sending (but still good to have for reference or other Twilio functionalities if any).** The code will prioritize the Messaging Service SID.

4.  **Redeploy:** After setting the new environment variable, redeploy your application on Vercel for the changes to take effect.

5.  **Monitor Logs:** Check Vercel runtime logs for SMS sending attempts. The logs will now indicate if the Messaging Service SID was used and if any errors occur.

## 5. If Issues Persist

*   Ensure the Messaging Service in Twilio is correctly configured (has numbers, linked to active A2P campaign if applicable, no errors showing in Twilio console for that service).
*   Check the Twilio account for any general errors, billing issues, or blocks.
*   Review the detailed error messages from Twilio in the Vercel logs if sends still fail.

This change to using `messagingServiceSid` is a common solution for deliverability problems in production environments, especially with evolving carrier regulations. 