// Based on rpiv-ask-user-question by juicesharp - Copyright (c) juicesharp
// MIT License: https://github.com/juicesharp/rpiv-ask-user-question

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TYPE_SOMETHING_LABEL = "Type something.";
const CHAT_ABOUT_THIS_LABEL = "Chat about this";
const CUSTOM_INPUT_PLACEHOLDER = "Type your answer";

const DECLINE_MESSAGE = "User declined to answer questions";
const CHAT_CONTINUATION_MESSAGE =
    "User wants to chat about this. Continue the conversation to help them decide.";
const CHAT_ANSWER_TAG = "User wants to chat about this";
const NO_INPUT_PLACEHOLDER = "(no input)";
const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
const ERROR_NO_OPTIONS = "Error: No options provided";

interface QuestionOption {
    label: string;
    description?: string;
    recommended?: boolean;
}

interface ToolDetails {
    question: string;
    answer: string | null;
    wasCustom?: boolean;
    wasChat?: boolean;
}

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
    const OptionSchema = Type.Object({
        label: Type.String({ description: "Display label for the option" }),
        description: Type.Optional(
            Type.String({ description: "Optional description shown with the label" }),
        ),
        recommended: Type.Optional(
            Type.Boolean({
                description: "Mark this option with a ★ Recommended badge",
            }),
        ),
    });

    pi.registerTool({
        name: "ask_user_question",
        label: "Ask User Question",
        description:
            "Ask the user a structured question with selectable options or a custom answer when work needs a decision.",
        parameters: Type.Object({
            question: Type.String({ description: "The question to ask the user" }),
            header: Type.Optional(Type.String({ description: "Section header for the question" })),
            options: Type.Array(OptionSchema, {
                description: "Options for the user to choose from",
            }),
        }),

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!ctx.hasUI)
                return buildToolResult(ERROR_NO_UI, { question: params.question, answer: null });
            if (params.options.length === 0)
                return buildToolResult(ERROR_NO_OPTIONS, {
                    question: params.question,
                    answer: null,
                });

            const optionTexts = params.options.map(formatOption);
            const otherChoice = `${params.options.length + 1}. ${TYPE_SOMETHING_LABEL}`;
            const chatChoice = `${params.options.length + 2}. ${CHAT_ABOUT_THIS_LABEL}`;
            const title = params.header ? `${params.header}\n${params.question}` : params.question;
            const choice = await ctx.ui.select(title, [...optionTexts, otherChoice, chatChoice]);

            if (choice === undefined)
                return buildToolResult(DECLINE_MESSAGE, {
                    question: params.question,
                    answer: null,
                });
            if (choice === otherChoice) {
                const input = await ctx.ui.input(params.question, CUSTOM_INPUT_PLACEHOLDER);
                if (input === undefined)
                    return buildToolResult(DECLINE_MESSAGE, {
                        question: params.question,
                        answer: null,
                    });
                const answer = input.length > 0 ? input : null;
                return buildToolResult(`User answered: ${answer ?? NO_INPUT_PLACEHOLDER}`, {
                    question: params.question,
                    answer,
                    wasCustom: true,
                });
            }
            if (choice === chatChoice)
                return buildToolResult(CHAT_CONTINUATION_MESSAGE, {
                    question: params.question,
                    answer: CHAT_ANSWER_TAG,
                    wasChat: true,
                });

            const selected = params.options[optionTexts.indexOf(choice)];
            return buildToolResult(`User selected: ${selected?.label ?? choice}`, {
                question: params.question,
                answer: selected?.label ?? choice,
                wasCustom: false,
            });
        },
    });
}

function formatOption(option: QuestionOption, index: number): string {
    const recommended = option.recommended ? " (★ Recommended)" : "";
    const description = option.description ? ` - ${option.description}` : "";
    return `${index + 1}. ${option.label}${recommended}${description}`;
}

function buildToolResult(text: string, details: ToolDetails) {
    return {
        content: [{ type: "text" as const, text }],
        details,
    };
}
