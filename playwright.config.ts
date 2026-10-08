import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'**/*.spec.ts',timeout:30000,use:{baseURL:'http://127.0.0.1:5174',channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,screenshot:'only-on-failure'},workers:1,webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:5174',reuseExistingServer:false,timeout:30000}});
