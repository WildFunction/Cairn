/** One answer from a QR sign-in poll, as both sides see it. */
export type LoginFailure = 'expired' | 'otp_expired' | 'no_skill' | 'rejected' | 'network';

export type LoginStep =
  | { readonly state: 'waiting' }
  | { readonly state: 'otp'; readonly wrong: boolean }
  | { readonly state: 'done'; readonly account: string }
  | { readonly state: 'failed'; readonly reason: LoginFailure };
