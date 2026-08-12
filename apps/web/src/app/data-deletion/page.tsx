/* eslint-disable react/no-unescaped-entities */
import React from 'react';

const DataDeletionPage = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-4 text-white">
      <h1 className="text-4xl font-bold mb-8">Data Deletion Instructions</h1>

      <div className="flex flex-col gap-4">
        <p>
          According to the Facebook Platform rules, we have to provide User Data Deletion Callback URL or Data Deletion Instructions URL.
          If you want to delete your data from the Bad Boys Podcast App, you can remove your information by following these steps:
        </p>

        <h2 className="text-2xl font-semibold">Option 1: Request Deletion via Email</h2>
        <p>
          Send an email to our administrator with the subject "Data Deletion Request". Please include your username or the email address associated with your account.
          We will process your request and delete your data within 30 days.
        </p>

        <h2 className="text-2xl font-semibold">Option 2: Facebook App Settings</h2>
        <p>
          If you used Facebook Login, you can also remove the app from your Facebook settings:
        </p>
        <ol className="list-decimal ml-6">
          <li>Go to your Facebook Account's Setting & Privacy. Click "Settings".</li>
          <li>Look for "Apps and Websites" and you will see all of the apps and websites you linked with your Facebook.</li>
          <li>Search and Click "Bad Boys Podcast" in the search bar.</li>
          <li>Scroll and click "Remove".</li>
          <li>Congratulations, you have successfully removed your app activities.</li>
        </ol>

        <h2 className="text-2xl font-semibold">Contact Us</h2>
        <p>
          If you have any issues or further questions regarding your data, please reach out to the site administrator.
        </p>
      </div>
    </div>
  );
};

export default DataDeletionPage;
