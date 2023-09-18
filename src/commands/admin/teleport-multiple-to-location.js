const {
  getServerConfigCommandOptionValue,
  handleCFToolsError,
  requiredServerConfigCommandOption,
  cftClient,
  requiredTeleportLocationOption,
  getTeleportLocationOptionValue,
  playerSessionOption,
  getPlayerSessionOptionValue
} = require('../../modules/cftClient');
const { ChatInputCommand } = require('../../classes/Commands');
const { ServerApiId } = require('cftools-sdk');
const { sleep, msToHumanReadableTime } = require('../../util');
const { MS_IN_ONE_SECOND } = require('../../constants');
const TELEPORT_COOLDOWN_IN_SECONDS = 15;

module.exports = new ChatInputCommand({
  global: true,
  permLevel: 'Administrator',
  data: {
    description: 'Teleport selected players to customizable locations',
    options: [
      requiredServerConfigCommandOption,
      requiredTeleportLocationOption,
      ...Array
        // 23, 25 is max, we use 2 already
        .from({ length: 23 })
        .map((e, ind) => ({
          ...playerSessionOption,
          name: `player-${ ind + 1 }`,
          description: 'Any in-game player'
        }))
    ]
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  run: async (client, interaction) => {
    // Destructuring and assignments
    const { member, options } = interaction;
    const { emojis } = client.container;

    // Check active/enabled
    const serverCfg = getServerConfigCommandOptionValue(interaction);
    if (!serverCfg.USE_TELEPORT_LOCATIONS) {
      interaction.reply(`${ emojis.error } ${ member }, teleport locations aren't enabled for this server configuration`);
      return;
    }

    // Resolve location
    const tpLocation = getTeleportLocationOptionValue(interaction);
    if (!tpLocation) {
      interaction.reply(`${ emojis.error } ${ member }, \`teleport-location\` can't be resolved. This usually happens when you change selected server while having loaded the \`teleport-location\` option, please try again - this command has been cancelled`);
      return;
    }

    // Try to destructure and verify type
    let coords;
    try {
      // eslint-disable-next-line array-element-newline, array-bracket-newline
      const { name, coordinates: [ x, y, z ] } = tpLocation;
      if (
        typeof x !== 'number'
        || typeof y !== 'number'
        || typeof z !== 'number'
      ) {
        interaction.editReply(`${ emojis.error } ${ member }, invalid coordinate configuration for teleport location **${ name }**: <${ x }, ${ y }, ${ z }>`);
        return;
      }
      coords = {
        x, y, z
      };
    }
    catch (err) {
      handleCFToolsError(interaction, err);
      return;
    }

    // Safe to destructure
    const {
      x, y, z
    } = coords;

    // Deferring our reply
    await interaction.deferReply();

    // Resolve all sessions from command options
    const allSessions = await Promise.all(
      Array
        .from({ length: 23 })
        .map((e, ind) => options.getString(`player-${ ind + 1 }`) ? getPlayerSessionOptionValue(interaction, `player-${ ind + 1 }`) : null)
        .filter((e) => e !== null) // truthy values only
    );

    // Notify start
    await interaction.editReply(`${ emojis.wait } ${ member }, teleporting selected players to **\`${ tpLocation.name }\`**, **this will happen in ${ TELEPORT_COOLDOWN_IN_SECONDS } second intervals to avoid getting rate limited**`);

    // Teleport selected players to target
    for await (const session of allSessions) {
      const sessionIndex = allSessions.indexOf(session);

      // Try to perform teleport, for each session
      // On a 15 second interval
      try {
        await cftClient.teleport({
          serverApiId: ServerApiId.of(serverCfg.CFTOOLS_SERVER_API_ID),
          session,
          coordinates: {
            x, y: z, z: y
          }
        });
      }
      catch (err) {
        handleCFToolsError(interaction, err, true);
        // Sleep for 15 seconds - even if error is encountered
        await sleep(MS_IN_ONE_SECOND * TELEPORT_COOLDOWN_IN_SECONDS);
        continue;
      }

      // Resolve remaining time str
      const remainingSeconds = TELEPORT_COOLDOWN_IN_SECONDS * (
        allSessions.length
        - (sessionIndex + 1)
      );
      const timeRemainingStr = sessionIndex + 1 !== allSessions.length
        ? ` ~${ msToHumanReadableTime(remainingSeconds * 1000) } remaining`
        : '';

      // Explicit await for non-static loop interval
      await interaction.followUp(`${ emojis.success } Teleported **\`${ session.playerName }\`** to **\`${ tpLocation.name }\`** (${ sessionIndex + 1 } out of ${ allSessions.length })${ timeRemainingStr }`);

      // Sleep for 15 seconds
      await sleep(MS_IN_ONE_SECOND * TELEPORT_COOLDOWN_IN_SECONDS);
    }

    // Ok, feedback
    interaction.editReply({ content: `${ emojis.success } ${ member }, selected players have been teleported to **\`${ tpLocation.name }\`**` });
    interaction.followUp(`${ emojis.success } ${ member }, finished teleporting`);
  }
});


