import { defineAuth } from '@aws-amplify/backend';

/**
 * Bar Blade auth — passwordless email OTP (replaces Firebase Google sign-in).
 *
 * Users sign in by entering their email and the one-time code we mail them; no
 * passwords, no Google. `otpLogin: true` enables the EMAIL_OTP first-factor
 * challenge on the Cognito USER_AUTH flow (see AuthContext requestLoginCode).
 *
 * Email OTP requires Cognito to send via Amazon SES, so `senders.email.fromEmail`
 * must be an SES-verified identity in this region (eu-west-2). We verified
 * contact@pauljohnson.me. While the SES account is in "sandbox" mode, codes can
 * only be delivered to other verified addresses — request SES production access
 * before onboarding real staff.
 *
 * @see https://docs.amplify.aws/react/build-a-backend/auth/concepts/passwordless/
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      otpLogin: true,
    },
  },
  senders: {
    email: {
      fromEmail: 'contact@pauljohnson.me',
      fromName: 'Bar Blade',
    },
  },
});
