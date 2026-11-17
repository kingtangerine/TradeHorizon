// Minimal types for the parts of the `web-push` package that server/alerts.ts uses (the package ships none).
declare module 'web-push' {
  interface VapidKeys { publicKey: string, privateKey: string }

  interface PushSubscription {
    endpoint: string
    keys: { p256dh: string, auth: string }
  }

  interface RequestOptions { TTL?: number }

  interface SendResult { statusCode: number, body: string, headers: Record<string, string> }

  interface WebPush {
    generateVAPIDKeys(): VapidKeys
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    sendNotification(subscription: PushSubscription, payload?: string | null, options?: RequestOptions): Promise<SendResult>
  }

  const webpush: WebPush
  export default webpush
}
