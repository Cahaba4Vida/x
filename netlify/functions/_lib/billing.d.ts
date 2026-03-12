type UsageInput = {
    llm_cost_usd?: number;
    browser_seconds?: number;
    desktop_seconds?: number;
    screenshots?: number;
    retries?: number;
};
export declare function estimateUnitsFromPrompt(prompt: string): number;
export declare function calculateBillableUnits(input: UsageInput): number;
export declare function recordUsageForTask(args: {
    organizationId: string;
    userId: string;
    taskId: string;
    runId: string;
    usage: UsageInput;
}): Promise<{
    usageLedgerId: string;
    billableUnits: number;
}>;
export declare function syncUsageToStripe(args: {
    usageLedgerId: string;
    userId: string;
    billableUnits: number;
}): Promise<{
    sent: boolean;
    reason: any;
} | {
    sent: boolean;
    reason?: undefined;
}>;
export {};
