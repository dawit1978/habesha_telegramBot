const { Telegraf, Markup } = require('telegraf');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Bot initialization
const bot = new Telegraf("7477909248:AAEBXzu4axD_AZZZzlZTxXJfgAqkX4_StRg");

// MySQL Connection
const dbConfig = {
    host: 'localhost',
    user: "root",
    password: "",
    database: "habesha4339",
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0
};

let db;

// Initialize MySQL connection pool
async function initializeDatabase() {
    try {
        db = await mysql.createPool(dbConfig);
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Failed to connect to the database:', error);
        process.exit(1); // Exit the process with failure
    }
}

initializeDatabase().catch(console.error);

// Admin credentials
const adminPassword ="admin123";
let isAdminAuthenticated = false;
const userStates = {};

// Middleware to check admin authentication
function isAdmin(ctx, next) {
    if (isAdminAuthenticated) {
        return next();
    } else {
        return ctx.reply('You are not authorized to use admin commands.');
    }
}

// Error handling middleware
bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        console.error('Bot encountered an error:', err);
        ctx.reply('An unexpected error occurred. Please try again later.');
    }
});
const getAdTypesFromDatabase = () => {
    return new Promise((resolve, reject) => {
        const query = 'SELECT DISTINCT ad_type FROM ads';
        db.query(query, (err, results) => {
            if (err) {
                return reject(err);
            }
            const adTypes = results.map(row => row.ad_type);
            resolve(adTypes);
        });
    });
};
// Help command to list all available commands
bot.command('help', (ctx) => {
    const commands = `
Available Commands:
/start - Start the bot
/check - Check if you have joined all required channels
/points - Check your points
/help - List all commands
    `;
    ctx.reply(commands);
});

// Start command
bot.start(async (ctx) => {
    try {
        const connection = await db.getConnection();
        const telegramId = ctx.from.id;
        const username = ctx.from.username || '';
        const [rows] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

        if (rows.length === 0) {
            const referrerId = ctx.startPayload ? parseInt(ctx.startPayload, 10) : null;
            await connection.query('INSERT INTO users (telegram_id, referrer_id, username) VALUES (?, ?, ?)', [telegramId, referrerId, username]);

            const welcomeMessage = `
                - እንኳን ደና መጡ! ሁሉንም ቻናሎች በመቀላቀል ሽልማት ያግኙ:
                - በመቀጠል  "Check"  ሲሉ  "referal link" ያገኛሉ.
            `;
            await ctx.reply(welcomeMessage, Markup.keyboard([
                [Markup.button.callback('Top Users', 'top_button')],
                [
                    Markup.button.callback('Check', 'left_button'),
                    Markup.button.callback('Points', 'right_button')
                ],
                [Markup.button.callback('Add Types', 'bottom_button')]
            ]).resize());
            // await ctx.replyWithPhoto({ source: "433pay.jpeg" });
        } else {
            const welcomeBackMessage = `
                - እንኳን ደና መጡ! ሁሉንም ቻናሎች በመቀላቀል ሽልማት ያግኙ:
                - በመቀጠል  "Check"  ሲሉ  "referal link" ያገኛሉ.
            `;
            await ctx.reply(welcomeBackMessage, Markup.keyboard([
                [Markup.button.callback('Top Users', 'top_button')],
                [
                    Markup.button.callback('Check', 'left_button'),
                    Markup.button.callback('Points', 'right_button')
                ],
                [Markup.button.callback('Add Types', 'bottom_button')]
            ]).resize());
            // await ctx.replyWithPhoto({ source: "433pay.jpeg" });
        }

        const [channels] = await connection.query('SELECT * FROM channels');
        const channelLinks = channels.map(channel => channel.channel_link);
        const channelButtons = channelLinks.map(link => Markup.button.url(`🔗 ${link}`, link));

        // Send channel links
        ctx.reply('Please join the following channels:     እነዚህን ቻናሎች ይቀላቀሉ', Markup.inlineKeyboard(
            channelButtons.map(button => [button])
        ));

        connection.release();
    } catch (error) {
        console.error('Error during start command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action(/^ad_type_(.+)$/, async (ctx) => {
    const adType = ctx.match[1];
    try {
        const connection = await db.getConnection();
        const [ad] = await connection.query('SELECT ad_link FROM advertisements WHERE ad_type = ?', [adType]);

        if (ad.length > 0) {
            ctx.reply(`Ad Link for ${adType}: ${ad[0].ad_link}`);
        } else {
            ctx.reply('No ad link found for the selected ad type.');
        }

        connection.release();
    } catch (error) {
        console.error('Error fetching ad link:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Check command

// Check command
bot.hears('Check', async (ctx) => {
    try {
        const connection = await db.getConnection();
        const telegramId = ctx.from.id;
        const [user] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

        if (user.length > 0) {
            const userId = user[0].id;
            const [channels] = await connection.query('SELECT * FROM channels');
            let joinedAllChannels = true;
            let notJoinedChannels = [];

            for (const channel of channels) {
                let chatId = channel.channel_link;

                if (chatId.startsWith('https://t.me/')) {
                    chatId = chatId.replace('https://t.me/', '@');
                }

                try {
                    const member = await bot.telegram.getChatMember(chatId, telegramId);
                    if (member.status === 'left' || member.status === 'kicked') {
                        joinedAllChannels = false;
                        notJoinedChannels.push(channel.channel_link);
                    }
                } catch (error) {
                    if (error.response && (error.response.error_code === 400 || error.response.error_code === 403)) {
                        console.warn(`Error checking membership for ${channel.channel_link}: ${error.description}`);
                    } else {
                        console.error(`Unexpected error checking membership for ${channel.channel_link}:`, error);
                        joinedAllChannels = false;
                        notJoinedChannels.push(channel.channel_link);
                    }
                }
            }

            if (joinedAllChannels) {
                ctx.reply('You have joined all required channels.');
                await generateReferralLink(ctx, userId);
            } else {
                let notJoinedMessage = 'You have not joined all required channels. Please join the following channels:\n';
                notJoinedMessage += notJoinedChannels.map(link => `- ${link}`).join('\n');

                // Call the start command
                await bot.telegram.sendMessage(telegramId, `
                    - እንኳን ደና መጡ! ሁሉንም ቻናሎች በመቀላቀል ሽልማት ያግኙ:
                    - በመቀጠል  "Check"  ሲሉ  "referal link" ያገኛሉ.
                `, Markup.keyboard([
                    [Markup.button.callback('Top Users', 'top_button')],
                    [
                        Markup.button.callback('Check', 'left_button'),
                        Markup.button.callback('Points', 'right_button')
                    ],
                    [Markup.button.callback('Add Types', 'bottom_button')]
                ]).resize());

                // Send the list of unjoined channels
                ctx.reply(notJoinedMessage);
            }
        } else {
            ctx.reply('You need to start the bot first using /start.');
        }

        connection.release();
    } catch (error) {
        console.error('Error during check command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});


// Points command (show only the user's points)
bot.hears('Points', async (ctx) => {
    try {
        const connection = await db.getConnection();
        const telegramId = ctx.from.id;

        const [rows] = await connection.query('SELECT points FROM users WHERE telegram_id = ?', [telegramId]);

        if (rows.length > 0) {
            const userPoints = rows[0].points;
            ctx.reply(`Your points: ${userPoints}`);
        } else {
            ctx.reply('No user found.');
        }

        connection.release();
    } catch (error) {
        console.error('Error during points command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Top Users command
bot.hears('Top Users', async (ctx) => {
    try {
        const connection = await db.getConnection();
        const telegramId = ctx.from.id;

        // Query to get all users ordered by points in descending order
        const [rows] = await connection.query('SELECT telegram_id, username, points FROM users ORDER BY points DESC');
        
        // Query to get the points of the user who sent the command
        const [userRow] = await connection.query('SELECT points FROM users WHERE telegram_id = ?', [telegramId]);

        if (rows.length > 0) {
            const userPoints = userRow.length > 0 ? userRow[0].points : 0;

            // Map the rows to include the rank and format the message
            const pointsList = rows.map((user, index) => `${index + 1}. ${user.username || user.telegram_id}: ${user.points} points`).join('\n');

            // Send the formatted points list and the user's points
            ctx.reply(`Top Users:\n${pointsList}\n\nYour points: ${userPoints}`);
        } else {
            ctx.reply('No users found.');
        }

        connection.release();
    } catch (error) {
        console.error('Error during top users command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});


// Referral link generation (run this once when user joins all channels)
function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function generateReferralLink(ctx, userId) {
    try {
        const connection = await db.getConnection();
        const referralCode = generateRandomString(10); // Generate a random string of 10 characters
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=${referralCode}`;
        await connection.query('UPDATE users SET referral_link = ?, points = points + 1 WHERE id = ?', [referralLink, userId]);
        ctx.reply('Here is your referral link: ' + referralLink);

        // Award point to referrer if exists
        const [user] = await connection.query('SELECT referrer_id FROM users WHERE id = ?', [userId]);
        if (user[0].referrer_id) {
            await connection.query('UPDATE users SET points = points + 1 WHERE id = ?', [user[0].referrer_id]);
        }

        connection.release();
    } catch (error) {
        console.error('Error generating referral link:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
}


// ------------Add types -------------

bot.hears('Add Types', async (ctx) => {
    try {
        const connection = await db;
        // Fetch ad types from the database
        const [ads] = await connection.query('SELECT ad_type FROM advertisements');
        const adTypes = ads.map(ad => ad.ad_type);

        if (adTypes.length === 0) {
            ctx.reply('No ad types available.');
            return;
        }

        // Create inline keyboard for ad types
        const adTypeButtons = adTypes.map(type => Markup.button.callback(type, `ad_type_${type}`));
        const keyboard = Markup.inlineKeyboard(adTypeButtons);

        ctx.reply('Select an ad type:', keyboard);
    } catch (error) {
        console.error('Error handling add types command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Admin login command
bot.command('admin', (ctx) => {
    const [_, password] = ctx.message.text.split(' ');
    if (password === adminPassword) {
        ctx.reply('Admin authenticated. You can now use admin commands.', Markup.inlineKeyboard([
            [Markup.button.callback('Add Channel', 'add_channel')],
            [Markup.button.callback('Remove Channel', 'remove_channel')],
            [Markup.button.callback('Add Advertisement', 'add_ad')],
            [Markup.button.callback('Remove Advertisement', 'remove_ad')],
            [Markup.button.callback('List Top Users', 'list_top_users')],
            [Markup.button.callback('List Referrals', 'list_referrals')]
        ]));
        isAdminAuthenticated = true;
    } else {
        ctx.reply('Incorrect password. Access denied.');
    }
});

// Add Channel
bot.action('add_channel', isAdmin, async (ctx) => {
    userStates[ctx.from.id] = 'awaiting_channel_link';
    ctx.reply('Please enter the channel link to add (e.g., https://t.me/yourchannel):', Markup.forceReply());
});

bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;

    if (userStates[adminId] === 'awaiting_channel_link') {
        const channelLink = ctx.message.text;

        // Validate Telegram channel link format
        const validChannelFormat = /^https:\/\/t\.me\/.+/;
        if (!validChannelFormat.test(channelLink)) {
            ctx.reply('Invalid channel link format. Please provide a valid Telegram channel link (e.g., https://t.me/yourchannel).');
            return;
        }

        try {
            const connection = await mysql.createConnection(dbConfig);
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                ctx.reply('Channel already exists.');
            } else {
                await connection.query('INSERT INTO channels (channel_link) VALUES (?)', [channelLink]);
                ctx.reply('Channel added successfully.');
            }
        } catch (error) {
            console.error('Error adding channel:', error);
            ctx.reply('An error occurred while adding the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else if (userStates[adminId] === 'awaiting_channel_removal') {
        const channelLink = ctx.message.text;

        try {
            const connection = await mysql.createConnection(dbConfig);
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                await connection.query('DELETE FROM channels WHERE channel_link = ?', [channelLink]);
                ctx.reply('Channel removed successfully.');
            } else {
                ctx.reply('Channel not found.');
            }
        } catch (error) {
            console.error('Error removing channel:', error);
            ctx.reply('An error occurred while removing the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else {
        const adTypes = await getAdTypesFromDatabase();
        if (adTypes.includes(ctx.message.text)) {
            // User selected an ad type
            await sendAdLink(ctx, ctx.message.text);
        } else {
            ctx.reply('Unknown command. Please use /help to see the list of available commands.');
        }
    }
});

// Remove Channel
bot.action('remove_channel', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [channels] = await connection.query('SELECT * FROM channels');
        const keyboard = Markup.inlineKeyboard(channels.map(channel => [Markup.button.callback(channel.channel_link, `remove_channel_${channel.id}`)]));
        ctx.reply('Select a channel to remove:', keyboard);
    } catch (error) {
        console.error('Error fetching channels:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action(/^remove_channel_(\d+)$/, isAdmin, async (ctx) => {
    const channelId = ctx.match[1];
    try {
        const connection = await db;
        await connection.query('DELETE FROM channels WHERE id = ?', [channelId]);
        ctx.reply('Channel removed successfully.');
    } catch (error) {
        console.error('Error removing channel:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Add Advertisement
bot.command('add_ad', async (ctx) => {
    const adText = ctx.message.text.split(' ').slice(1).join(' ');
    if (!adText) {
        return ctx.reply('Please provide the ad text. Usage: /add_ad [ad text]');
    }

    try {
        // Fetch ad types (if necessary for your logic)
        const adTypes = await getAdTypesFromDatabase();
        console.log('Ad types:', adTypes);

        const query = 'INSERT INTO ads (ad_text) VALUES (?)';
        db.query(query, [adText], (err, result) => {
            if (err) {
                console.error('Error inserting ad into the database:', err);
                return ctx.reply('Failed to add the ad. Please try again later.');
            }
            ctx.reply('Ad added successfully!');
        });
    } catch (error) {
        console.error('Error fetching ad types:', error);
        ctx.reply('Failed to fetch ad types. Please try again later.');
    }
});

// Remove Advertisement
bot.action('remove_ad', isAdmin, async (ctx) => {
    try {
        const connection = await db.getConnection();
        const [ads] = await connection.query('SELECT * FROM advertisements');
        if (ads.length === 0) {
            ctx.reply('No advertisements to remove.');
            connection.release();
            return;
        }
        const adButtons = ads.map(ad => Markup.button.callback(`${ad.ad_type}`, `remove_ad_${ad.id}`));
        ctx.reply('Select an advertisement to remove:', Markup.inlineKeyboard(adButtons.map(button => [button])));
        connection.release();
    } catch (error) {
        console.error('Error fetching advertisements:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action(/^remove_ad_(\d+)$/, isAdmin, async (ctx) => {
    const adId = parseInt(ctx.match[1], 10);
    try {
        const connection = await db.getConnection();
        await connection.query('DELETE FROM advertisements WHERE id = ?', [adId]);
        ctx.reply('Advertisement removed successfully.');
        connection.release();
    } catch (error) {
        console.error('Error removing advertisement:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// List Top Users (Admin)
bot.action('list_top_users', isAdmin, async (ctx) => {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.query('SELECT username, points FROM users ORDER BY points DESC LIMIT 10');
        if (rows.length > 0) {
            const topUsers = rows.map((user, index) => `${index + 1}. ${user.username || user.telegram_id}: ${user.points} points`).join('\n');
            ctx.reply(`Top 10 Users:\n${topUsers}`);
        } else {
            ctx.reply('No users found.');
        }
        connection.release();
    } catch (error) {
        console.error('Error fetching top users:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// List Referrals (Admin)
bot.action('list_referrals', isAdmin, async (ctx) => {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.query('SELECT u1.username AS referrer, u2.username AS referred FROM users u1 JOIN users u2 ON u1.id = u2.referrer_id');
        if (rows.length > 0) {
            const referrals = rows.map(row => `Referrer: ${row.referrer || 'Unknown'}, Referred: ${row.referred || 'Unknown'}`).join('\n');
            ctx.reply(`Referrals:\n${referrals}`);
        } else {
            ctx.reply('No referrals found.');
        }
        connection.release();
    } catch (error) {
        console.error('Error fetching referrals:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Error handling
bot.catch((err) => {
    console.error('Bot error:', err);
});

// Graceful shutdown
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    if (db) db.end();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    if (db) db.end();
});

// Start the bot
bot.launch().then(() => {
    console.log('Bot started successfully');
}).catch(error => {
    console.error('Failed to start the bot:', error);
});
