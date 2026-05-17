export default function PrivacyPolicyPage() {
  const lastUpdated = "May 17, 2025";
  const contactEmail = "jackjiabaozhang2006@gmail.com";
  const appName = "Muse";

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Privacy Policy</h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-2" />
      <p className="font-data text-xs text-paper-3 mb-10">Last updated: {lastUpdated}</p>

      <div className="space-y-8 font-data text-sm text-paper-2 leading-relaxed">

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Overview</h2>
          <p>
            {appName} is a music marketing tool that helps artists create beat-synced videos and
            distribute them to TikTok. This privacy policy explains what data we collect, how we
            use it, and your rights regarding that data.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Data We Collect</h2>
          <ul className="space-y-2 list-none">
            <li className="border-l border-sub pl-4">
              <span className="text-paper font-medium">Account information</span> — your email
              address and artist name, used to identify your account.
            </li>
            <li className="border-l border-sub pl-4">
              <span className="text-paper font-medium">Audio files</span> — songs you upload for
              analysis and video generation. These are stored securely and used solely to produce
              your videos.
            </li>
            <li className="border-l border-sub pl-4">
              <span className="text-paper font-medium">TikTok OAuth tokens</span> — when you
              connect your TikTok account, we store your access token, refresh token, and TikTok
              Open ID. These are used exclusively to post videos and retrieve performance metrics
              on your behalf.
            </li>
            <li className="border-l border-sub pl-4">
              <span className="text-paper font-medium">TikTok video metrics</span> — view counts,
              like counts, share counts, and comment counts for videos posted through {appName}.
              These are fetched from TikTok's API and displayed in your analytics dashboard.
            </li>
            <li className="border-l border-sub pl-4">
              <span className="text-paper font-medium">Generated video files</span> — rendered
              video outputs stored temporarily to facilitate TikTok uploads.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">How We Use Your Data</h2>
          <ul className="space-y-2 list-none">
            <li className="border-l border-sub pl-4">Authenticating you and securing your account</li>
            <li className="border-l border-sub pl-4">Analyzing your audio to generate beat-synced video edits</li>
            <li className="border-l border-sub pl-4">Publishing videos to TikTok on your behalf using your connected account</li>
            <li className="border-l border-sub pl-4">Fetching and displaying post performance metrics from TikTok</li>
          </ul>
          <p className="mt-3">
            We do not sell your data, use it for advertising, or share it with third parties
            beyond what is required to operate the service (TikTok's API and our storage provider).
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">TikTok Integration</h2>
          <p className="mb-3">
            {appName} integrates with TikTok via the TikTok Login Kit and Content Posting API.
            By connecting your TikTok account you grant {appName} permission to:
          </p>
          <ul className="space-y-2 list-none mb-3">
            <li className="border-l border-sub pl-4">Read your basic profile information (<code className="text-xs bg-surface px-1 py-0.5">user.info.basic</code>)</li>
            <li className="border-l border-sub pl-4">Upload and publish videos to your account (<code className="text-xs bg-surface px-1 py-0.5">video.upload</code>, <code className="text-xs bg-surface px-1 py-0.5">video.publish</code>)</li>
            <li className="border-l border-sub pl-4">List your videos to retrieve performance metrics (<code className="text-xs bg-surface px-1 py-0.5">video.list</code>)</li>
          </ul>
          <p>
            You can revoke access at any time by disconnecting your account on the TikTok page
            within {appName}, or by removing {appName} from your TikTok app permissions at{" "}
            <span className="text-paper">tiktok.com/setting/</span>.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Data Retention</h2>
          <p>
            Your data is retained for as long as your account is active. TikTok OAuth tokens are
            deleted immediately when you disconnect your TikTok account. You may request deletion
            of all your data at any time by contacting us.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Data Security</h2>
          <p>
            Access tokens and credentials are stored encrypted at rest. All communication between
            {appName} and TikTok's API is made over HTTPS. We limit access to your data to
            only the operations you explicitly initiate.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Your Rights</h2>
          <p className="mb-3">You have the right to:</p>
          <ul className="space-y-2 list-none">
            <li className="border-l border-sub pl-4">Access the personal data we hold about you</li>
            <li className="border-l border-sub pl-4">Request correction of inaccurate data</li>
            <li className="border-l border-sub pl-4">Request deletion of your account and all associated data</li>
            <li className="border-l border-sub pl-4">Revoke TikTok access at any time without affecting your {appName} account</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Contact</h2>
          <p>
            For any privacy-related questions or data requests, contact us at{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-paper hover:text-accent transition-colors underline underline-offset-2"
            >
              {contactEmail}
            </a>
            .
          </p>
        </section>

      </div>
    </div>
  );
}
