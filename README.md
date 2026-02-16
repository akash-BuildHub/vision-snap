# Vision Snap

Vision Snap is a React + Vite web app to capture and manage image samples for ML workflows.

## Features

- Add, rename, and delete classes
- Capture samples from webcam
- Upload image or video files
- Hold-and-record frame capture
- Remove single sample or all samples
- Download class samples as `.zip`
- Image lightbox with keyboard navigation

## Tech Stack

- React 18
- Vite 5
- JSZip

## Project Structure

```text
.
|-- public/
|   `-- Images/
|       `-- Vision Snap logo.png
|-- src/
|   |-- App.jsx
|   |-- main.jsx
|   `-- styles.css
|-- index.html
|-- package.json
`-- .gitignore
```

## Local Development

```bash
npm install
npm run dev
```

App runs by default at `http://localhost:5173`.
