const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType
} = require('discord.js');
const fs = require('fs');
require('dotenv').config();
const cron = require('node-cron');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FARM_CHANNEL_ID = '1377721036044505098';
const REPORT_CHANNEL_ID = '1411691552274645112'

// Função utilitária para normalizar textos (sem acentos, sem pontuação, maiúsculas)
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9\s]/ig, "")
        .toUpperCase()
        .trim();
}

// === Mapa de golpes para cargos ===
const golpeCargoMap = {
    [normalizeText("CAYO PERICO")]: "1408190721847988275",
    [normalizeText("CASSINO")]: "1408211090612944906",
    [normalizeText("CASSINO DIAMOND")]: "1408211090612944906",
    [normalizeText("ASSALTO AO BANCO FLEECA")]: "1408440723392565391",
    [normalizeText("FUGA DA PRISAO")]: "1408440828631847034",
    [normalizeText("INVASAO AO LABORATORIO HUMANE")]: "1408440909003100212",
    [normalizeText("FINANCIAMENTO SERIE A")]: "1408441029245534281",
    [normalizeText("ASSALTO AO BANCO PACIFIC STANDARD")]: "1408441127459229868",
    [normalizeText("VICENT")]: "1408211381622280242"
};

// Armazena IDs das mensagens de relatório por usuário e ranking
let userReportMessages = {};
if (fs.existsSync('./userReportMessages.json')) {
    try {
        userReportMessages = JSON.parse(fs.readFileSync('./userReportMessages.json', 'utf-8'));
    } catch (e) {
        console.error('Erro ao ler userReportMessages.json, resetando...', e);
        userReportMessages = {};
    }
}

let rankingMessageId = null;
let rankingTimestamp = null;

let farmData = {};
if (fs.existsSync('./farmData.json')) {
    try {
        farmData = JSON.parse(fs.readFileSync('./farmData.json', 'utf-8'));
        farmData.monthly = farmData.monthly || {};
        farmData.total = farmData.total || {};
    } catch (e) {
        console.error('Erro ao ler farmData.json — resetando para padrão.', e);
        farmData = { monthly: {}, total: {} };
        fs.writeFileSync('./farmData.json', JSON.stringify(farmData, null, 2));
    }
} else {
    farmData = { monthly: {}, total: {} };
}

// Funções utilitárias
function formatNumber(num) {
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function formatValue(num) {
    if (num >= 2000000) return `${formatNumber(num)} MILHÕES`;
    if (num >= 1000000) return `${formatNumber(num)} MILHÃO`;
    if (num >= 1000) return `${formatNumber(num)} MIL`;
    return `${num}`;
}

// AQUI ESTÁ A FUNÇÃO parseMessage ATUALIZADA
function parseMessage(content) {
    content = content.trim().toUpperCase();
    const valorRegex = /([\d\.]+)\s*(MIL|MILHAO|MILHÃO|MILHOES|MILHÕES)/i;
    const golpeRegex = /(?:SERVIÇO\s*)?(VICENT)(?:\s*—\s*CLUCKIN BELL)?|,\s*(.+?)(?:\s*<@|$)/i;

    let valor = 0;
    const valorMatch = content.match(valorRegex);
    if (valorMatch) {
        const valorStr = valorMatch[1].replace(/\./g, '');
        valor = parseInt(valorStr, 10);
    }
    
    let golpe = "Indefinido";
    const golpeMatch = content.match(golpeRegex);

    if (golpeMatch) {
        if (golpeMatch[1]) golpe = golpeMatch[1].trim();
        else if (golpeMatch[2]) golpe = golpeMatch[2].trim();
    } else if (content.includes("VICENT")) {
        golpe = "VICENT";
    }

    if (normalizeText(golpe) === "VICENT" && valor === 0) {
        valor = 1;
    }

    console.log(`📑 Mensagem recebida: "${content}"`);
    console.log(`📑 Valor capturado: ${valor}`);
    console.log(`📑 Golpe capturado: "${golpe}"`);

    return { valor, golpe };
}

function saveData() {
    fs.writeFileSync('./farmData.json', JSON.stringify(farmData, null, 2));
}

// ... o resto do seu script continua igual ...

// ---------- Relatório e ranking editáveis ----------
let lastFirstPlaceId = null;
let lastCongratsMsgId = null;

async function generateReport(channel = null, teste = false) {
    const reportChannel = channel || await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
    if (!reportChannel) return;

    const allUserIds = new Set();
    for (const [hostId, data] of Object.entries(farmData.monthly)) {
        allUserIds.add(hostId);
        const apoKeys = Object.keys(data.apoiadores || {});
        apoKeys.forEach(id => allUserIds.add(id));
    }

    for (const userId of allUserIds) {
        const member = await reportChannel.guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        const user = await client.users.fetch(userId);

        const userMonthly = farmData.monthly[userId] || { total: 0, golpesCount: {}, apoiadores: {}, numGolpes: 0 };
        const golpesOrdenados = Object.entries(userMonthly.golpesCount || {})
            .sort((a, b) => b[1] - a[1])
            .map(([golpe, numGolpes]) => {
                const key = golpe.trim().toUpperCase();
                const nomeGolpe = golpeCargoMap[key] ? `<@&${golpeCargoMap[key]}>` : golpe;
                return `${nomeGolpe} ( ${numGolpes} )`;
            });

        let fraseGolpe = "**Serviço|Golpe:**";
        let golpesTexto = golpesOrdenados.join(' — ');
        if (golpesTexto === '') golpesTexto = 'Nenhum golpe registrado esta semana.';

        let campoValor = `**<:1397premiumbot:1410472705869742080> Dinheiro conquistado:** ${formatValue(userMonthly.total || 0)}\n${fraseGolpe} ${golpesTexto}`;

        if (userMonthly.apoiadores && Object.keys(userMonthly.apoiadores).length > 0) {
            const apoiadoresArr = [];
            for (const apoiaId of Object.keys(userMonthly.apoiadores)) {
                const apoiaUser = await client.users.fetch(apoiaId).catch(() => null);
                if (apoiaUser) apoiadoresArr.push(`${apoiaUser}`);
            }
            if (apoiadoresArr.length > 0) campoValor += `\n**Apoiadores:** ${apoiadoresArr.join(", ")}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`RELATÓRIO SEMANAL ${member.displayName.toUpperCase()}`)
            .setDescription(campoValor)
            .setColor('#FFEC00')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }));

        if (userReportMessages[userId]) {
            const msg = await reportChannel.messages.fetch(userReportMessages[userId]).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed] });
            else userReportMessages[userId] = (await reportChannel.send({ embeds: [embed] })).id;
        } else {
            userReportMessages[userId] = (await reportChannel.send({ embeds: [embed] })).id;
        }

        // <- SALVA NO JSON sempre que gerar ou atualizar relatório
        fs.writeFileSync('./userReportMessages.json', JSON.stringify(userReportMessages, null, 2));
    }

    // ---------- Ranking ----------
    let rankingArr = Object.entries(farmData.total)
        .map(([id, d]) => ({
            id,
            total: d.total || 0,
            numGolpes: d.numGolpes || 0
        }))
        .sort((a, b) => b.total - a.total);

    const rankingLines = rankingArr.map((entry, index) => {
        let medal = '';
        if (index === 0) medal = '<:medal261:1410341499031257313>';
        else if (index === 1) medal = '<:IOS_2stPlaceMedal21:1410341609790378134>';
        else if (index === 2) medal = '<:IOS_3stPlaceMedal5:1410341626361938112>';
        else medal = `${index + 1}.`;
        return `${medal} — <@${entry.id}> ﾠ${formatValue(entry.total)} ﾠ ( S|G ${entry.numGolpes} )`;
    });

    const formattedRanking = rankingLines.length > 3 ? rankingLines.slice(0, 3).join('\n') + '\n\n' + rankingLines.slice(3).join('\n') : rankingLines.join('\n');

    const rankingEmbed = new EmbedBuilder()
        .setTitle('<a:trophywinchampcu:1410341650391236751> RANKING DE VALORES REGISTRADOS NA COMUNIDADE! <a:moneybag:1405178051935076392>')
        .setColor('#FFD700')
        .setDescription(formattedRanking || 'Nenhum registro.');

    if (rankingMessageId) {
        const oldMsg = await reportChannel.messages.fetch(rankingMessageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => null);
    }
    const rankingMsg = await reportChannel.send({ embeds: [rankingEmbed] });
    rankingMessageId = rankingMsg.id;
    rankingTimestamp = Date.now();

    // ---------- PARABÉNS 1º LUGAR ----------
    const congratsChannel = await client.channels.fetch("1392555751351914517").catch(() => null);
    if (congratsChannel && rankingArr.length > 0) {
        const first = rankingArr[0];
        if (first.id !== lastFirstPlaceId) {
            if (lastCongratsMsgId) {
                const oldCongrats = await congratsChannel.messages.fetch(lastCongratsMsgId).catch(() => null);
                if (oldCongrats) await oldCongrats.delete().catch(() => null);
            }

            const user = await client.users.fetch(first.id).catch(() => null);
            if (user) {
                const congratsEmbed = new EmbedBuilder()
                    .setTitle("<:medal261:1410341499031257313> NOVO LÍDER NO RANKING DE VALORES!")
                    .setDescription(`<a:confetiss:1410158284001771530> Parabéns! <@${first.id}> **conquistou o primeiro lugar** no ranking de valores da comunidade, **${formatValue(first.total)}.** <a:moneybag:1405178051935076392>`)
                    .setColor("#FFEC00")
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }));

                const congratsMsg = await congratsChannel.send({ embeds: [congratsEmbed] });
                lastCongratsMsgId = congratsMsg.id;
                lastFirstPlaceId = first.id;
            }
        }
    }

    if (!teste) saveData();
}

// --- No cron de limpeza semanal ---
cron.schedule('25 12 * * 0', async () => {
    const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
    if (!reportChannel) return;

    for (const msgId of Object.values(userReportMessages)) {
        const msg = await reportChannel.messages.fetch(msgId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
    }

    userReportMessages = {};
    farmData.monthly = {};
    saveData();
    fs.writeFileSync('./userReportMessages.json', JSON.stringify(userReportMessages, null, 2));
    console.log('🗑️ Relatórios semanais apagados com sucesso!');
});

// --- Cron job: apagar ranking após 2 meses ---
cron.schedule('0 0 * * *', async () => { // verifica diariamente à  meia-noite
    if (!rankingTimestamp) return;
    const twoMonths = 60 * 24 * 60 * 60 * 1000; // 60 dias em ms
    if (Date.now() - rankingTimestamp > twoMonths) {
        const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
        if (!reportChannel) return;
        const msg = await reportChannel.messages.fetch(rankingMessageId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
        rankingMessageId = null;
        rankingTimestamp = null;
        saveData();
        console.log('🗑️ Ranking antigo apagado após 2 meses.');
    }
});

// --- Servidor HTTP para UptimeRobot ---
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot ativo ✅');
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor de uptime rodando na porta ${PORT}`);
});

// --- Faz login do bot no Discord ---
client.login(DISCORD_TOKEN);




