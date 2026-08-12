import React from 'react';

const TermsPage = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4 text-white">
      <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
      <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>

      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">1. Agreement to Terms</h2>
        <p>
          By accessing or using the Bad Boys Podcast website, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
        </p>

        <h2 className="text-2xl font-semibold">2. User Accounts</h2>
        <p>
          To access certain features of the website, you may be required to register for an account. You agree to provide accurate, current, and complete information during the registration process. You are responsible for safeguarding your account information.
        </p>

        <h2 className="text-2xl font-semibold">3. User Content</h2>
        <p>
          You retain ownership of any content you submit, post, or display on or through the service (e.g., comments, voice messages). By submitting content, you grant us a worldwide, non-exclusive, royalty-free license to use, copy, reproduce, process, adapt, modify, publish, transmit, display, and distribute such content.
        </p>
        <p>
          You agree not to post content that is:
        </p>
        <ul className="list-disc ml-6">
          <li>Illegal, harmful, or offensive.</li>
          <li>Infringing on intellectual property rights.</li>
          <li>Contains malware or viruses.</li>
        </ul>

        <h2 className="text-2xl font-semibold">4. Termination</h2>
        <p>
          We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of the Terms.
        </p>

        <h2 className="text-2xl font-semibold">5. Limitation of Liability</h2>
        <p>
          In no event shall Bad Boys Podcast, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the service.
        </p>

        <h2 className="text-2xl font-semibold">6. Changes to Terms</h2>
        <p>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any time. By continuing to access or use our service after those revisions become effective, you agree to be bound by the revised terms.
        </p>
      </div>
    </div>
  );
};

export default TermsPage;
