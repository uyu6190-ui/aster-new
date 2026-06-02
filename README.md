# Aster Flashcard IR

Intelligent Recall Management System.

## Getting Started

This project is built with **React**, **Vite**, and **Tailwind CSS**. It uses **Firebase** for data persistence and **Google Gemini AI** for content generation.

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone or extract the project.
2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Configuration

Create a `.env` file in the root directory and add your Firebase and Gemini API configurations (do NOT commit this file):

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Gemini API Key (keep this secure!)
GEMINI_API_KEY=your_gemini_api_key
```

Firebase config is read from `VITE_FIREBASE_*` variables first. If they are not set, the app falls back to `firebase-applet-config.json`.

Gemini requests are handled by the server-side `/api/gemini` endpoint. Keep `GEMINI_API_KEY` as a server-only variable; do not add a `VITE_` prefix to it.

For Vercel, set these Environment Variables in Project Settings:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `GEMINI_API_KEY`

Also add your Vercel production domain to Firebase Authentication > Settings > Authorized domains.

*Note: In the AI Studio environment, these are managed via the platform. Locally, you will need to provide your own Firebase project credentials.*

### Development

Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

To check the Gemini server endpoint locally without exposing the key:

```bash
curl -s -X POST http://localhost:3000/api/gemini \
  -H "Content-Type: application/json" \
  -d '{"action":"status"}'
```

The response should show `"configured":true` when `GEMINI_API_KEY` is present in your local `.env` or Vercel environment.

### Production Build

To create a production-ready bundle:
```bash
npm run build
```
The output will be in the `dist/` directory.

### Vercel

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## Project Structure

- `src/`: Application source code (React components, hooks, logic).
- `public/`: Static assets (icons, manifest).
- `index.html`: Main entry point.
- `vite.config.ts`: Vite configuration.
- `tailwind.config.js`: Tailwind CSS configuration.
- `firestore.rules`: Firebase Security Rules.
- `firebase-blueprint.json`: Data schema definition.
