# Telegram Forecast Bot

## Overview
A Node.js betting forecast bot that scrapes game results from a website, analyzes Big/Small outcomes, and sends predictions to Telegram every 30 seconds. The bot implements a martingale-style betting strategy (3x multiplier on losses, reset on wins). Control the bot using Telegram commands.

## Project Structure
- `index.js` - Main bot application with web scraping and command listener
- `.env.example` - Template for environment variables
- `package.json` - Node.js dependencies and project metadata
- `.gitignore` - Protects sensitive data from git commits

## Features
- **Web Scraping**: Fetches actual game results from a website using Cheerio
- **Telegram Commands**: `/start`, `/stop`, `/status` for bot control
- **Smart Betting Strategy**: 
  - If prediction is correct: Reset bet to 1RS and flip size
  - If prediction is wrong: Multiply bet by 3RS and keep same size
- **Prediction Logic**: Predicts opposite of last result (if last ≥5, predict SMALL; else predict BIG)
- **Auto-send**: Sends forecasts every 30 seconds when active
- **History Tracking**: Maintains last 10 actual game results
- **Console Logging**: Monitor bot activity and prediction accuracy

## How to Use
1. **Add Environment Secrets** in Replit:
   - `BOT_TOKEN` - Your Telegram bot token from BotFather
   - `CHAT_ID` - Your Telegram chat ID
   - `SITE_URL` - The website URL to scrape results from

2. **Start the Bot**: The workflow runs automatically once secrets are added

3. **Control via Telegram**:
   - Send `/start` to begin receiving forecasts every 30 seconds
   - Send `/stop` to pause forecasts
   - Send `/status` to check current status, bet amount, and recent history

## Configuration
Required environment variables:
- `BOT_TOKEN` - Your Telegram bot token from BotFather
- `CHAT_ID` - Your Telegram chat ID where forecasts will be sent
- `SITE_URL` - Website URL with game results (must have table with selector `#historyTable table tbody tr`)

## Dependencies
- `axios` - HTTP requests for web scraping
- `cheerio` - HTML parsing to extract game results
- `node-telegram-bot-api` - Telegram bot integration
- `dotenv` - Environment variable management

## Recent Changes
- 2025-10-24: Initial project setup with Node.js, axios, and dotenv
- 2025-10-24: Added web scraping with Cheerio to fetch actual game results
- 2025-10-24: Implemented proper martingale betting logic with actual results
- 2025-10-24: Added `/start`, `/stop`, and `/status` commands
- 2025-10-24: Switched from ES modules to CommonJS for compatibility
- Security: All credentials stored as environment variables
