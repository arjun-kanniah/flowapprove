import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // next to DocPilot's 5173
    // IPv4 explicitly: "localhost" can bind only ::1, which the dev container's port forwarding misses
    host: '127.0.0.1',
    // Forward API calls and live updates to the API so the browser sees one origin
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
})
