# Salt Bot

![Version](https://img.shields.io/badge/version-1.2.1-blue)
![License](https://img.shields.io/badge/license-Apache%202.0-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-7289da)
![TypeScript](https://img.shields.io/badge/typescript-v5.2.2-blue)

A feature-rich Discord bot for ticket management, server moderation, and premium user handling, built with TypeScript and Discord.js.

## Features

### 🎫 Advanced Ticket System

- **Multiple Ticket Categories**: Organize tickets by type with customizable categories
- **Customizable Ticket Panels**: Create beautiful ticket panels with custom buttons and embeds
- **Ticket Transcripts**: Automatic HTML transcripts when tickets are closed
- **Ticket Management**: Open, close, reopen, archive, and delete tickets
- **Support Role Integration**: Assign specific roles to handle different ticket categories
- **Ticket Statistics**: View detailed statistics about ticket usage

### 💎 Premium System

- **Premium User Management**: Grant premium status to users
- **Coupon System**: Generate and redeem coupon codes for premium access
- **Time-based Premium**: Set expiration dates for premium access

### 🛡️ User Management

- **User Blocking**: Block problematic users from using the bot
- **Block History**: Maintain a history of block/unblock actions and reasons

### 📝 Logging System

- **Command Logging**: Log all command usage
- **Error Handling**: Comprehensive error logging system
- **Formatted Logs**: Organized log files with date-based directories

## Prerequisites

- Node.js 16.9.0 or higher
- PostgreSQL database
- Discord Bot Token

## Installation

1. **Clone the repository**
   ```bash
   git clone git@github.com:muralianand12345/Salt-Bot.git
   cd salt-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Create a `.env` file.
   - Fill in the required variables:
   ```
   TOKEN=your_discord_bot_token
   POSTGRES_URI=postgres://username:password@hostname:port/database
   DEBUG_MODE=false
   FEEDBACK_WEBHOOK=your_webhook_url
   ```

4. **Set up the config file**
   - Copy `config/config.example.yml` to `config/config.yml`
   - Edit the configuration to match your needs

5. **Build the TypeScript code**
   ```bash
   tsc
   ```

6. **Run the bot**
   ```bash
   node .
   ```

## Database Schema

The bot uses PostgreSQL with TypeORM for database operations. The main entities are:

- **GuildConfig**: Server-specific bot configuration
- **TicketCategory**: Categories for organizing tickets
- **Ticket**: Individual user tickets
- **TicketMessage**: Custom messages for ticket interactions
- **UserData**: User-specific data including premium status
- **BlockedUser**: Users blocked from using the bot
- **PremiumCoupon**: Coupon codes for premium access

## Commands

### Ticket Commands

- `/setup` - Set up the ticket system
- `/ticket deploy` - Deploy the ticket panel to a channel
- `/ticket config` - Configure ticket settings
- `/ticket close` - Close a ticket
- `/ticket reopen` - Reopen a closed ticket
- `/ticket info` - Get information about a ticket
- `/ticket transcript` - Generate a transcript of the ticket

### Premium Commands

- `/premium status` - Check your premium status
- `/premium redeem` - Redeem a premium coupon
- `!generate` - Generate premium coupons (bot owners only)

### System Commands

- `/ping` - Check bot status and latency
- `/block` - Manage user blocks
- `/stop` - Disable or manage the ticket system

## Configuration

The bot is highly configurable through both the `config.yml` file and in-app commands. See the example configuration file for all available options.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

## Acknowledgements

- [Discord.js](https://discord.js.org/) - The Discord API library
- [TypeORM](https://typeorm.io/) - ORM for database operations
- [discord-html-transcripts](https://github.com/ItzDerock/discord-html-transcripts) - For generating HTML transcripts

## Support

If you need help with setup or encounter any issues, please open an issue on GitHub or join our [support server](https://discord.gg/XzE9hSbsNb).