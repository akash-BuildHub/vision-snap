# Vision Snap

Vision Snap is a React + Vite web app for capturing and organizing image samples for machine learning workflows.

## Features

- Create, rename, and delete classes
- Capture samples from a webcam
- Upload image or video files
- Hold-to-record frame capture
- Remove individual samples or clear all samples
- Download class samples as `.zip`
- Preview images in a modal viewer with keyboard navigation

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
`-- package.json
```

## Getting Started

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.
