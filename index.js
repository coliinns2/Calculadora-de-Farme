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
let rankingMessageId = null;
let rankingTimestamp = null;

let farmData = {};
if (fs.existsSync('./farmData.json')) {
    try {
        farmData = JSON.parse(fs.readFileSync('./farmData.json', 'utf-8'));
        farmData.monthly = farmData.monthly || {};
        farmData.total = farmData.total || {};
    } catch (e) {
        console.error('Erro ao ler farmData.json â€” resetando para padrÃ£o.', e);
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
    // Se grupo 1 existir, é Vicent
    if (golpeMatch[1]) golpe = golpeMatch[1].trim();
    // Se grupo 2 existir, é golpe normal
    else if (golpeMatch[2]) golpe = golpeMatch[2].trim();
} else if (content.includes("VICENT")) {
    golpe = "VICENT";
}

    // Se o golpe for "Vicent", atribui um valor temporÃ¡rio para que o script nÃ£o retorne
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

function initUserData(userId) {
    if (!farmData.monthly[userId]) farmData.monthly[userId] = { total: 0, golpes: {}, golpesCount: {}, apoiadores: {}, numGolpes: 0 };
    if (!farmData.total[userId]) farmData.total[userId] = { total: 0, numGolpes: 0, golpesCount: {} };
}

// Pergunta host pelas porcentagens
async function askHostPercentages(message) {
    const mentions = Array.from(message.mentions.users.values()).slice(0, 3);
    if (mentions.length === 0) return;

    const { golpe } = parseMessage(message.content);
    const normalizedGolpe = normalizeText(golpe === "CASSINO" ? "CASSINO DIAMOND" : golpe);
    let golpeTexto = golpeCargoMap[normalizedGolpe] ? `<@&${golpeCargoMap[normalizedGolpe]}>` : golpe;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`openModal_${message.id}`)
            .setLabel('Definir porcentagem')
            .setStyle(ButtonStyle.Primary)
    );

    await message.reply({
        content: `<@${message.author.id}>, **defina a porcentagem** que cada apoiador @mencionado recebeu do seu golpe ${golpeTexto}`,
        components: [row],
        ephemeral: true
    });
}

// Processa mensagens do canal (host publica o golpe)
async function processMessage(message) {
    if (message.channel.id !== FARM_CHANNEL_ID) return;
    if (message.author.bot) return;

    const { valor, golpe } = parseMessage(message.content);
    if (valor === 0) return;

    const normalizedGolpe = normalizeText(golpe === "CASSINO" ? "CASSINO DIAMOND" : golpe);
    const authorId = message.author.id;
    initUserData(authorId);
    const mentions = Array.from(message.mentions.users.values()).slice(0, 3);
    mentions.forEach(user => initUserData(user.id));

    if (!farmData.monthly[authorId].golpesCount[normalizedGolpe])
        farmData.monthly[authorId].golpesCount[normalizedGolpe] = 0;
    farmData.monthly[authorId].golpesCount[normalizedGolpe] += 1;
    farmData.monthly[authorId].numGolpes += 1;

    if (!farmData.total[authorId].golpesCount[normalizedGolpe])
        farmData.total[authorId].golpesCount[normalizedGolpe] = 0;
    farmData.total[authorId].golpesCount[normalizedGolpe] += 1;
    farmData.total[authorId].numGolpes += 1;

    // Vicent — Cluckin' Bell: cria botão modal
    if (normalizedGolpe === "VICENT") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vicentModalButton_${message.id}`)
                .setLabel("Responder Vicent")
                .setStyle(ButtonStyle.Primary)
        );
        await message.reply({ content: `<@${authorId}>, clique para responder o questionário do golpe Vicent`, components: [row] });
        return; // não pede porcentagem ou elite
    }

    await askHostPercentages(message);

    const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
    if (reportChannel) await generateReport(reportChannel, true);

    saveData();
}

// ---------- Interações ----------
client.on('interactionCreate', async (interaction) => {

    // --- Modal específico para Vicent — Cluckin' Bell ---
    if (interaction.isButton() && interaction.customId.startsWith('vicentModalButton_')) {
        const messageId = interaction.customId.split('_')[1];
        const modal = new ModalBuilder()
            .setCustomId(`vicentModal_${messageId}`)
            .setTitle("Vicent — Cluckin' Bell");

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('primeiraVez')
                    .setLabel('Primeira vez realizando o golpe ? (Sim/Não)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
    }

    // --- Modal Submit para Vicent — Cluckin' Bell ---
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('vicentModal_')) {
        const messageId = interaction.customId.split('_')[1];
        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const primeiraVez = (interaction.fields.getTextInputValue('primeiraVez') || '').toLowerCase();
        const { golpe } = parseMessage(message.content);
        const normalizedGolpe = normalizeText(golpe);

        if (!['VICENT'].includes(normalizedGolpe.toUpperCase())) return;

        const authorId = message.author.id;
        initUserData(authorId);

        const mentions = Array.from(message.mentions.users.values());
        mentions.forEach(user => initUserData(user.id));

        const valorHost = primeiraVez === 'sim' ? 750000 : 500000;
        const valorApoiador = 50000;

        for (const user of mentions) {
            if (user.id === authorId) continue;
            farmData.monthly[user.id].total += valorApoiador;
            farmData.total[user.id].total += valorApoiador;

            if (!farmData.monthly[user.id].golpesCount[normalizedGolpe]) farmData.monthly[user.id].golpesCount[normalizedGolpe] = 0;
            farmData.monthly[user.id].golpesCount[normalizedGolpe] += 1;
            farmData.monthly[user.id].numGolpes += 1;

            if (!farmData.total[user.id].golpesCount[normalizedGolpe]) farmData.total[user.id].golpesCount[normalizedGolpe] = 0;
            farmData.total[user.id].golpesCount[normalizedGolpe] += 1;
            farmData.total[user.id].numGolpes += 1;

            farmData.monthly[authorId].apoiadores[user.id] = valorApoiador;
        }

        farmData.monthly[authorId].total += valorHost;
        farmData.total[authorId].total += valorHost;

        if (!farmData.monthly[authorId].golpes) farmData.monthly[authorId].golpes = {};
        if (!farmData.monthly[authorId].golpes[normalizedGolpe]) farmData.monthly[authorId].golpes[normalizedGolpe] = 0;
        farmData.monthly[authorId].golpes[normalizedGolpe] += valorHost;

        await interaction.reply({ content: `✅ Valores aplicados: Host recebeu ${formatValue(valorHost)} e cada apoiador recebeu ${formatValue(valorApoiador)}.`, ephemeral: true });

        const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
        if (reportChannel) await generateReport(reportChannel, true);
        saveData();
        return;
    }

});

// ---------- Interações ----------
client.on('interactionCreate', async (interaction) => {

    // abrir modal porcentagens
    if (interaction.isButton() && interaction.customId.startsWith('openModal_')) {
        const messageId = interaction.customId.split('_')[1];
        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const mentions = Array.from(message.mentions.users.values()).slice(0, 3);
        if (mentions.length === 0) return;

        const modal = new ModalBuilder()
            .setCustomId(`percentModal_${messageId}`)
            .setTitle('Definir porcentagem');

        mentions.forEach(user => {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(`percent_${user.id}`)
                        .setLabel(`Porcentagem de ${user.username} (%)`)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('15')
                        .setRequired(true)
                )
            );
        });

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('eliteBonus')
                    .setLabel('Desafio de elite completado? (Sim/Não)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
    }

    // Modal de porcentagens (distribuição + bônus de elite)
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('percentModal_')) {
        const messageId = interaction.customId.split('_')[1];
        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const { valor, golpe } = parseMessage(message.content);
        // Normaliza golpe antes de usar (CASSINO => CASSINO DIAMOND)
        const normalizedGolpe = normalizeText(golpe === "CASSINO" ? "CASSINO DIAMOND" : golpe);

        const authorId = message.author.id; // o host original (quem publicou a mensagem)
        initUserData(authorId);

        const mentions = Array.from(message.mentions.users.values()).slice(0, 3);
        mentions.forEach(user => initUserData(user.id));

        let totalDistribuido = 0;

        // Distribui para apoiadores (não conta o host aqui)
        for (const user of mentions) {
            if (user.id === authorId) continue;

            const percentStr = interaction.fields.getTextInputValue(`percent_${user.id}`);
            const percent = parseFloat(percentStr || '0');
            const userValor = Math.round(valor * (percent / 100));
            totalDistribuido += userValor;

            farmData.monthly[user.id].total += userValor;
            farmData.total[user.id].total += userValor;

            // incrementa golpe contado para o apoiador usando chave normalizada (apenas 1 vez)
            if (!farmData.monthly[user.id].golpesCount[normalizedGolpe]) farmData.monthly[user.id].golpesCount[normalizedGolpe] = 0;
            farmData.monthly[user.id].golpesCount[normalizedGolpe] += 1;
            farmData.monthly[user.id].numGolpes += 1;

            if (!farmData.total[user.id].golpesCount[normalizedGolpe]) farmData.total[user.id].golpesCount[normalizedGolpe] = 0;
            farmData.total[user.id].golpesCount[normalizedGolpe] += 1;
            farmData.total[user.id].numGolpes += 1;

            // salva quanto o host deu pro apoiador
            farmData.monthly[authorId].apoiadores[user.id] = userValor;
        }

        // Valor restante para host
        const valorHost = valor - totalDistribuido;
        farmData.monthly[authorId].total += valorHost;
        farmData.total[authorId].total += valorHost;

        // armazena valor do golpe para o host usando chave normalizada (para consistência)
        if (!farmData.monthly[authorId].golpes) farmData.monthly[authorId].golpes = {};
        if (!farmData.monthly[authorId].golpes[normalizedGolpe]) farmData.monthly[authorId].golpes[normalizedGolpe] = 0;
        farmData.monthly[authorId].golpes[normalizedGolpe] += valorHost;

        // --- Checa Elite ---
        const eliteInput = (interaction.fields.getTextInputValue('eliteBonus') || '').toLowerCase();

        if (eliteInput === 'sim') {
            // Cayo Perico precisa de modal de modo
            if (normalizeText(golpe) === normalizeText("CAYO PERICO")) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`openModeModal_${messageId}`)
                        .setLabel('Definir modo do golpe')
                        .setStyle(ButtonStyle.Primary)
                );
                await interaction.deferReply({ ephemeral: true });
                await interaction.followUp({ content: '⚠️ **Clique para definir o modo do golpe e receber o bônus**.', components: [row], ephemeral: true });
            }
            // Cassino (normalize) => bônus 50k
            else if (normalizedGolpe === normalizeText("CASSINO DIAMOND")) {
                const participants = [...mentions];
                if (!participants.find(u => u.id === authorId)) participants.push(await client.users.fetch(authorId));

                for (const user of participants) {
                    initUserData(user.id);
                    farmData.monthly[user.id].total += 50000;
                    farmData.total[user.id].total += 50000;
                    // NÃO incrementamos golpesCount aqui — apenas adicionamos bônus monetário
                }

                await interaction.reply({ content: '✅ ELITE FEITO! Bônus de 50000 aplicado para todos.', ephemeral: true });
            }
            // Os novos golpes recebem 100k quando elite
            else {
                const normalizedLista = [
                    normalizeText("ASSALTO AO BANCO FLEECA"),
                    normalizeText("FUGA DA PRISAO"),
                    normalizeText("INVASAO AO LABORATORIO HUMANE"),
                    normalizeText("FINANCIAMENTO SERIE A"),
                    normalizeText("ASSALTO AO BANCO PACIFIC STANDARD")
                ];
                if (normalizedLista.includes(normalizedGolpe)) {
                    const participants = [...mentions];
                    if (!participants.find(u => u.id === authorId)) participants.push(await client.users.fetch(authorId));

                    for (const user of participants) {
                        initUserData(user.id);
                        farmData.monthly[user.id].total += 100000;
                        farmData.total[user.id].total += 100000;
                        // NÃO incrementamos golpesCount aqui — apenas adicionamos bônus monetário
                    }

                    await interaction.reply({ content: '✅ ELITE FEITO! Bônus de 100000 aplicado para todos.', ephemeral: true });
                } else {
                    // golpe não na lista -> responde normalmente (sem bônus adicional)
                    await interaction.reply({ content: '✅ Valores aplicados sem bônus de elite ou golpe sem tratamento especial.', ephemeral: true });
                }
            }
        } else {
            await interaction.reply({ content: '✅ Valores aplicados sem bônus de elite.', ephemeral: true });
        }

        const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
        if (reportChannel) await generateReport(reportChannel, true);
        saveData();
    }

    // Botão para abrir modal de modo do golpe (Cayo Perico)
    if (interaction.isButton() && interaction.customId.startsWith('openModeModal_')) {
        const messageId = interaction.customId.split('_')[1];
        const modal = new ModalBuilder()
            .setCustomId(`modeModal_${messageId}`)
            .setTitle('Definir modo do golpe');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('modoGolpe')
                    .setLabel('Modo do golpe (Normal/Difícil)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
    }

    // Modal de modo do golpe (Cayo Perico)
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modeModal_')) {
        const messageId = interaction.customId.split('_')[1];
        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const modo = interaction.fields.getTextInputValue('modoGolpe').toLowerCase();
        const { golpe } = parseMessage(message.content);

        const mentions = Array.from(message.mentions.users.values()).slice(0, 3);
        if (!mentions.find(u => u.id === interaction.user.id)) mentions.push(interaction.user);

        const bonusValor = (modo === 'difícil' || modo === 'dificil') ? 100000 : 50000;

        for (const user of mentions) {
            initUserData(user.id);
            farmData.monthly[user.id].total += bonusValor;
            farmData.total[user.id].total += bonusValor;
        }

        await interaction.reply({ content: `✅ Bônus de elite aplicado! Cada participante recebeu ${bonusValor}.`, ephemeral: true });

        const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
        if (reportChannel) await generateReport(reportChannel, true);
        saveData();
    }

}); // <-- FECHA interactionCreate corretamente


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

  // === NOVO TRECHO: PARABÉNS PRO 1º LUGAR ===
  const congratsChannel = await client.channels.fetch("1392555751351914517").catch(() => null);
  if (congratsChannel && rankingArr.length > 0) {
    const first = rankingArr[0]; // primeiro colocado
    if (first.id !== lastFirstPlaceId) {
      // Apaga a última mensagem de parabéns, se existir
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

// Eventos de mensagem
client.on('messageCreate', async (message) => {
    const content = message.content.toLowerCase();
    if (content.startsWith('!relatório')) {
        const isTest = content.includes('teste');
        await generateReport(message.channel, isTest);
    } else {
        await processMessage(message);
    }
});

// Evento de inicialização do bot
client.on('ready', () => {
    console.log(`✅ Bot logado como ${client.user.tag}!`);

    const channelId = "1377721036044505098"; // canal de boas-vindas
    const channel = client.channels.cache.get(channelId);

    if (channel) {
        const embed = new EmbedBuilder()
            .setColor(0xFFEC00)
            .setDescription("<:verified:1405172419827732530> **Bot Online!** pronto para **monitorar**, **registrar**, **calcular** e **divulgar** valores de golpes e serviços dos membros da comunidade! <a:moneybag:1405178051935076392>")

        channel.send({ embeds: [embed] });
    } else {
        console.log("⚠️ Não consegui encontrar o canal com o ID informado.");
    }
});

// --- Cron job: apagar relatórios semanais todo domingo às 19h ---
cron.schedule('30 11 * * 0', async () => {
    const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
    if (!reportChannel) return;

    for (const msgId of Object.values(userReportMessages)) {
        const msg = await reportChannel.messages.fetch(msgId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
    }
    userReportMessages = {};
    farmData.monthly = {};
    saveData();
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


