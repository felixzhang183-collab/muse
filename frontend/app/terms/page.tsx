export default function TermsOfServicePage() {
  const lastUpdated = "May 17, 2025";
  const contactEmail = "jackjiabaozhang2006@gmail.com";
  const appName = "Muse";

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Terms of Service</h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-2" />
      <p className="font-data text-xs text-paper-3 mb-10">Last updated: {lastUpdated}</p>

      <div className="space-y-8 font-data text-sm text-paper-2 leading-relaxed">

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Agreement</h2>
          <p>
            By accessing or using {appName}, you agree to be bound by these Terms of Service.
            If you do not agree, do not use the service. {appName} is a music marketing tool
            that generates beat-synced videos and distributes them to TikTok on your behalf.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Eligibility</h2>
          <p>
            You must be at least 13 years old to use {appName}, and at least the minimum age
            required by TikTok in your country. By using the service you represent that you meet
            these requirements.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Your Content</h2>
          <ul className="space-y-2 list-none mb-3">
            <li className="border-l border-sub pl-4">
              You retain all ownership rights to the audio files and content you upload.
            </li>
            <li className="border-l border-sub pl-4">
              By uploading content you grant {appName} a limited license to process, store, and
              use it solely to provide the service — generating videos and publishing them to
              TikTok as you direct.
            </li>
            <li className="border-l border-sub pl-4">
              You are solely responsible for ensuring you own or have the rights to any audio,
              samples, or other material you upload.
            </li>
            <li className="border-l border-sub pl-4">
              You must not upload content that infringes copyright, contains illegal material,
              or violates TikTok's Community Guidelines.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">TikTok Integration</h2>
          <p className="mb-3">
            {appName} connects to your TikTok account to post videos and retrieve metrics on
            your behalf. By connecting your TikTok account you acknowledge that:
          </p>
          <ul className="space-y-2 list-none">
            <li className="border-l border-sub pl-4">
              You authorize {appName} to publish content to TikTok as directed by you.
            </li>
            <li className="border-l border-sub pl-4">
              You are responsible for all content posted to TikTok through {appName} and for
              compliance with{" "}
              <span className="text-paper">TikTok's Terms of Service and Community Guidelines</span>.
            </li>
            <li className="border-l border-sub pl-4">
              {appName} is not affiliated with, endorsed by, or responsible for TikTok.
            </li>
            <li className="border-l border-sub pl-4">
              You can revoke {appName}'s access to your TikTok account at any time.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Acceptable Use</h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="space-y-2 list-none">
            <li className="border-l border-sub pl-4">Use {appName} for any unlawful purpose or in violation of any applicable laws</li>
            <li className="border-l border-sub pl-4">Upload content that infringes the intellectual property rights of others</li>
            <li className="border-l border-sub pl-4">Attempt to reverse engineer, scrape, or abuse the service</li>
            <li className="border-l border-sub pl-4">Use the service to distribute spam or unsolicited content at scale</li>
            <li className="border-l border-sub pl-4">Share your account credentials with others</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Service Availability</h2>
          <p>
            {appName} is provided as-is. We do not guarantee uninterrupted availability and
            may modify, suspend, or discontinue the service at any time without notice. We are
            not liable for any loss resulting from service downtime or changes.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Disclaimer of Warranties</h2>
          <p>
            {appName} is provided "as is" and "as available" without warranties of any kind,
            express or implied, including but not limited to warranties of merchantability,
            fitness for a particular purpose, or non-infringement. We do not warrant that
            videos generated will meet your expectations or that TikTok will accept or publish
            any particular content.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, {appName} and its operators shall not be
            liable for any indirect, incidental, special, or consequential damages arising from
            your use of the service, including but not limited to loss of revenue, lost data,
            or TikTok account actions taken as a result of content posted through {appName}.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Account Termination</h2>
          <p>
            You may delete your account at any time by contacting us. We reserve the right to
            suspend or terminate accounts that violate these terms. Upon termination, your data
            will be deleted in accordance with our{" "}
            <a
              href="/privacy"
              className="text-paper hover:text-accent transition-colors underline underline-offset-2"
            >
              Privacy Policy
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Changes to These Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of {appName} after
            changes are posted constitutes acceptance of the revised terms. The date at the
            top of this page reflects the most recent update.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper mb-3">Contact</h2>
          <p>
            Questions about these terms? Reach us at{" "}
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
