import React from 'react';

const PrivacyPage = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4 text-white">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>

      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">1. Introduction</h2>
        <p>
          Welcome to the Bad Boys Podcast. We respect your privacy and are committed to protecting your personal data.
          This privacy policy will inform you as to how we look after your personal data when you visit our website
          and tell you about your privacy rights and how the law protects you.
        </p>

        <h2 className="text-2xl font-semibold">2. Data We Collect</h2>
        <p>
          We may collect, use, store and transfer different kinds of personal data about you which we have grouped together follows:
        </p>
        <ul className="list-disc ml-6">
          <li><strong>Identity Data:</strong> includes first name, last name, username or similar identifier (from third-party login providers).</li>
          <li><strong>Contact Data:</strong> includes email address.</li>
          <li><strong>Technical Data:</strong> includes internet protocol (IP) address, browser type and version, time zone setting and location, operating system and platform.</li>
          <li><strong>Usage Data:</strong> includes information about how you use our website, such as votes, comments, and messages.</li>
        </ul>

        <h2 className="text-2xl font-semibold">3. How We Use Your Data</h2>
        <p>
          We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:
        </p>
        <ul className="list-disc ml-6">
          <li>To register you as a new user (via third-party authentication).</li>
          <li>To manage our relationship with you.</li>
          <li>To enable you to participate in interactive features of our service (e.g., voting, commenting).</li>
        </ul>

        <h2 className="text-2xl font-semibold">4. Data Security</h2>
        <p>
          We have put in place appropriate security measures to prevent your personal data from being accidentally lost, used or accessed in an unauthorized way, altered or disclosed.
        </p>

        <h2 className="text-2xl font-semibold">5. Contact Details</h2>
        <p>
          If you have any questions about this privacy policy or our privacy practices, please contact us.
        </p>
      </div>
    </div>
  );
};

export default PrivacyPage;
