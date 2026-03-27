module.exports = {
  apps: [
    {
      name: 'argus-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 3100',
      cwd: 'C:/Users/jishin/Dev/argus/web',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_NAME: 'argus',
        DB_USER: 'argus',
        DB_PASSWORD: 'argus_password_change_me',
        JWT_SECRET: 'change-this-secret',
        PORT: '3100',
      },
      watch: false,
      max_memory_restart: '1G',
    },
  ],
}
