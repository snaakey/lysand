import { apiRoute, applyConfig, idValidator } from "@api";
import { errorResponse, jsonResponse } from "@response";
import { config } from "config-manager";
import ISO6391 from "iso-639-1";
import { z } from "zod";
import { federateNote, parseTextMentions } from "~database/entities/Status";
import { db } from "~drizzle/db";
import { Note } from "~packages/database-interface/note";

export const meta = applyConfig({
    allowedMethods: ["POST"],
    ratelimits: {
        max: 300,
        duration: 60,
    },
    route: "/api/v1/statuses",
    auth: {
        required: true,
    },
});

export const schema = z.object({
    status: z.string().max(config.validation.max_note_size).trim().optional(),
    // TODO: Add regex to validate
    content_type: z.string().optional().default("text/plain"),
    media_ids: z
        .array(z.string().regex(idValidator))
        .max(config.validation.max_media_attachments)
        .optional(),
    spoiler_text: z.string().max(255).trim().optional(),
    sensitive: z.boolean().optional(),
    language: z.enum(ISO6391.getAllCodes() as [string, ...string[]]).optional(),
    "poll[options]": z
        .array(z.string().max(config.validation.max_poll_option_size))
        .max(config.validation.max_poll_options)
        .optional(),
    "poll[expires_in]": z
        .number()
        .int()
        .min(config.validation.min_poll_duration)
        .max(config.validation.max_poll_duration)
        .optional(),
    "poll[multiple]": z.boolean().optional(),
    "poll[hide_totals]": z.boolean().optional(),
    in_reply_to_id: z.string().regex(idValidator).optional().nullable(),
    quote_id: z.string().regex(idValidator).optional().nullable(),
    visibility: z
        .enum(["public", "unlisted", "private", "direct"])
        .optional()
        .default("public"),
    scheduled_at: z.string().optional().nullable(),
    local_only: z.boolean().optional(),
    federate: z.boolean().optional().default(true),
});

/**
 * Post new status
 */
export default apiRoute<typeof meta, typeof schema>(
    async (req, matchedRoute, extraData) => {
        const { user, application } = extraData.auth;

        if (!user) return errorResponse("Unauthorized", 401);

        const config = await extraData.configManager.getConfig();

        const {
            status,
            media_ids,
            "poll[options]": options,
            in_reply_to_id,
            quote_id,
            scheduled_at,
            sensitive,
            spoiler_text,
            visibility,
            content_type,
            federate,
        } = extraData.parsedRequest;

        // Validate status
        if (!status && !(media_ids && media_ids.length > 0)) {
            return errorResponse(
                "Status is required unless media is attached",
                422,
            );
        }

        if (media_ids && media_ids.length > 0 && options) {
            // Disallow poll
            return errorResponse("Cannot attach poll to media", 422);
        }

        if (scheduled_at) {
            if (
                Number.isNaN(new Date(scheduled_at).getTime()) ||
                new Date(scheduled_at).getTime() < Date.now()
            ) {
                return errorResponse(
                    "Scheduled time must be in the future",
                    422,
                );
            }
        }

        // Check if status body doesnt match filters
        if (
            config.filters.note_content.some((filter) => status?.match(filter))
        ) {
            return errorResponse("Status contains blocked words", 422);
        }

        // Check if media attachments are all valid
        if (media_ids && media_ids.length > 0) {
            const foundAttachments = await db.query.Attachments.findMany({
                where: (attachment, { inArray }) =>
                    inArray(attachment.id, media_ids),
            }).catch(() => []);

            if (foundAttachments.length !== (media_ids ?? []).length) {
                return errorResponse("Invalid media IDs", 422);
            }
        }

        // Check that in_reply_to_id and quote_id are real posts if provided
        if (in_reply_to_id) {
            const foundReply = await Note.fromId(in_reply_to_id);
            if (!foundReply) {
                return errorResponse("Invalid in_reply_to_id (not found)", 422);
            }
        }

        if (quote_id) {
            const foundQuote = await Note.fromId(quote_id);
            if (!foundQuote) {
                return errorResponse("Invalid quote_id (not found)", 422);
            }
        }

        const mentions = await parseTextMentions(status ?? "");

        const newNote = await Note.fromData(
            user,
            {
                [content_type]: {
                    content: status ?? "",
                },
            },
            visibility,
            sensitive ?? false,
            spoiler_text ?? "",
            [],
            undefined,
            mentions,
            media_ids,
            in_reply_to_id ?? undefined,
            quote_id ?? undefined,
            application ?? undefined,
        );

        if (!newNote) {
            return errorResponse("Failed to create status", 500);
        }

        if (federate) {
            await federateNote(newNote);
        }

        return jsonResponse(await newNote.toAPI(user));
    },
);
