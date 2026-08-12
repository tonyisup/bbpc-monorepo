# Bad Boys Podcast Admin - Functionality Documentation

This document outlines the functionality of the Bad Boys Podcast Admin application. The application is a web-based tool for managing podcast episodes, users, and related data.

## Technology Stack

- **Framework**: Next.js (React)
- **API**: tRPC
- **Authentication**: NextAuth.js
- **Database ORM**: Prisma
- **Styling**: Tailwind CSS

## Core Functionality

### 1. Authentication & Authorization

- **Sign-in/Sign-out**: Users can sign in and out of the application. Authentication is handled by NextAuth.js.
- **Admin-Only Access**: All administrative pages and API routes are protected. Access is granted only to users with an "admin" role. The application checks for a valid session and admin privileges on both the server-side (`getServerSideProps`) and for API calls.

### 2. Episode Management

This feature allows admins to manage all aspects of podcast episodes.

- **List Episodes (`/episode`)**:
    - Displays a table of all podcast episodes, showing the episode number, title, and air date.
    - **Create**: A modal allows for the creation of new episodes.
    - **Read**: Each episode title links to a detailed edit page (`/episode/[id]`).
    - **Delete**: A button allows for the removal of an episode.
    - **Plain View**: A link is provided to a simplified, text-based view of the episode's data (`/episode/plain/[id]`).

- **Edit Episode (`/episode/[id]`)**:
    - A detailed form to edit an episode's properties:
        - Episode Number
        - Title
        - Description
        - Air Date
        - Recording URL
    - **Associated Data Management**: This page also includes components for managing data related to the episode:
        - `EpisodeAssignments`: Manages homework, extra credit, and bonus assignments for the episode. New assignments default to playable; admins can clear that setting during creation or change it later from the assignment detail page.
        - `EpisodeExtras`: Manages additional content or notes for the episode.
        - `EpisodeLinks`: Manages relevant links for the episode.
        - `EpisodeAudioMessages`: Manages audio messages associated with the episode.

- **Plain Episode View (`/episode/plain/[id]`)**:
    - Provides a clean, pre-formatted text output of an episode's key information.
    - This view is designed for easy copying and pasting.
    - It includes:
        - Assignments for the current episode.
        - "Extras" (reviews).
        - A preview of the assignments for the upcoming episode.

### 3. User Management

This feature allows admins to manage users and their associated roles and content.

- **List Users (`/user`)**:
    - Displays a table of all users with their name and email.
    - **Create**: A modal allows for the addition of new users.
    - **Read**: Each user's email links to their detailed management page (`/user/[id]`).
    - **Delete**: A button allows for the removal of a user.
    - **Search**: A search bar allows for filtering users by name or email.

- **Edit User (`/user/[id]`)**:
    - A comprehensive page for managing a single user.
    - **User Profile**: A form to update the user's name, email, and point total.
    - **Role Management**:
        - Lists the user's current roles.
        - Provides the ability to add new roles via a modal.
        - Allows for the removal of existing roles.
    - **Syllabus Management**:
        - Displays a list of movies assigned to the user (their "syllabus").
        - For each movie, an admin can assign it to a specific podcast episode as "Homework", "Extra Credit", or "Bonus".
        - Assignments can be removed from the syllabus.
