import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";

export interface ICalendarEventLike {
    summary?: string | null;
    start?: {
        date?: string | null;
        dateTime?: string | null;
    } | null;
}

interface IBuildEventContainerOptions {
    header: string;
    events: ICalendarEventLike[];
    timezone: string;
}

const formatSection = (title: string, emoji: string, items: string[]) => {
    const content = items.length > 0 ? `>>> ${items.join("\n")}` : ">>> _No events_";
    const header = emoji ? `### ${emoji}⠀${title}` : `### ${title}`;
    return `${header}\n${content}`;
};

const bucketEventsByTime = (events: ICalendarEventLike[], timezone: string) => {
    const allDay: string[] = [];
    const morning: string[] = [];
    const afternoon: string[] = [];
    const evening: string[] = [];

    for (const event of events) {
        const summary = event.summary || "(No Title)";

        if (event.start?.date) {
            allDay.push(summary);
            continue;
        }

        if (event.start?.dateTime) {
            const startDate = new Date(event.start.dateTime);
            const timeStr = startDate.toLocaleTimeString("en-US", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
            });

            const hourStr = startDate.toLocaleTimeString("en-US", {
                timeZone: timezone,
                hour: "numeric",
                hour12: false,
            });
            const hour = parseInt(hourStr, 10);
            const line = `\` ${timeStr} \`⠀${summary}`;

            if (hour < 12) {
                morning.push(line);
            } else if (hour < 17) {
                afternoon.push(line);
            } else {
                evening.push(line);
            }
        }
    }

    allDay.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

    return { allDay, morning, afternoon, evening };
};

export const buildEventSectionsContainer = (
    options: IBuildEventContainerOptions,
): ContainerBuilder => {
    const { header, events, timezone } = options;
    const { allDay, morning, afternoon, evening } = bucketEventsByTime(events, timezone);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
    );

    const sections = [
        { title: "All Day", emoji: "🌅", items: allDay },
        { title: "Morning", emoji: "☕", items: morning },
        { title: "Afternoon", emoji: "☀️", items: afternoon },
        { title: "Evening", emoji: "🌙", items: evening },
    ];

    sections.forEach((section, index) => {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                formatSection(section.title, section.emoji, section.items),
            ),
        );

        if (index < sections.length - 1) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
            );
        }
    });

    return container;
};

export const buildSimpleTextContainer = (content: string): ContainerBuilder => {
    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
    );
};
