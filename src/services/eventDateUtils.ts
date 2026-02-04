export const getYmdInTimezone = (date: Date, timezone: string): string => {
    return date.toLocaleDateString("en-CA", { timeZone: timezone });
};

export const addDaysToYmd = (ymd: string, days: number): string => {
    const utcDate = new Date(`${ymd}T00:00:00Z`);
    utcDate.setUTCDate(utcDate.getUTCDate() + days);
    return utcDate.toISOString().split("T")[0];
};

export const iterateYmdRangeInclusive = (startYmd: string, endYmd: string): string[] => {
    const days: string[] = [];
    let current = startYmd;
    while (current <= endYmd) {
        days.push(current);
        current = addDaysToYmd(current, 1);
    }
    return days;
};

export const toAllDayEventForYmd = (event: any, ymd: string): any => {
    return {
        ...event,
        start: { date: ymd },
        end: { date: addDaysToYmd(ymd, 1) },
    };
};
