import {
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

export interface Command {
  data: { name: string; toJSON(): unknown };
  /** The reply is already deferred (ephemeral) by the router, so use interaction.editReply. */
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** Handles buttons and modals whose customId starts with `prefix`. */
export interface ComponentHandler {
  prefix: string;
  handleButton?(interaction: ButtonInteraction): Promise<void>;
  handleModal?(interaction: ModalSubmitInteraction): Promise<void>;
}

/** Every command works in servers and in a DM with the bot. */
export function baseCommand(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);
}
