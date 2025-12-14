import { describe, expect, it } from "vitest";
import {
	getGitlabAccessLevelName,
	hasDeveloperOrHigherAccess,
} from "@dokploy/server";

describe("GitLab access level helpers", () => {
	it("maps GitLab access levels to readable names", () => {
		expect(getGitlabAccessLevelName(50)).toBe("owner");
		expect(getGitlabAccessLevelName(40)).toBe("maintainer");
		expect(getGitlabAccessLevelName(30)).toBe("developer");
		expect(getGitlabAccessLevelName(20)).toBe("reporter");
		expect(getGitlabAccessLevelName(10)).toBe("guest");
		expect(getGitlabAccessLevelName(null)).toBe("none");
	});

	it("detects developer or higher access", () => {
		expect(hasDeveloperOrHigherAccess(10)).toBe(false);
		expect(hasDeveloperOrHigherAccess(20)).toBe(false);
		expect(hasDeveloperOrHigherAccess(30)).toBe(true);
		expect(hasDeveloperOrHigherAccess(40)).toBe(true);
		expect(hasDeveloperOrHigherAccess(50)).toBe(true);
	});
});
