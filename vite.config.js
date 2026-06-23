import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        clothing: 'clothing.html',
        electronics: 'electronics.html',
        jewellery: 'jewellery.html',
        about: 'about.html',
      }
    }
  }
}) 
