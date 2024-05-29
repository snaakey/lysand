/**
 * @deprecated
 */
import { afterAll, describe, expect, test } from "bun:test";
import { config } from "~/packages/config-manager";
import type { Application as APIApplication } from "~/types/mastodon/application";
import type { Token as APIToken } from "~/types/mastodon/token";
import { getTestUsers, sendTestRequest, wrapRelativeUrl } from "./utils";

const base_url = config.http.base_url;

let client_id: string;
let client_secret: string;
let code: string;
let jwt: string;
let token: APIToken;
const { users, passwords, deleteUsers } = await getTestUsers(1);

afterAll(async () => {
    await deleteUsers();
});

describe("POST /api/v1/apps/", () => {
    test("should create an application", async () => {
        const formData = new FormData();

        formData.append("client_name", "Test Application");
        formData.append("website", "https://example.com");
        formData.append("redirect_uris", "https://example.com");
        formData.append("scopes", "read write");

        const response = await sendTestRequest(
            new Request(new URL("/api/v1/apps", config.http.base_url), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_name: "Test Application",
                    website: "https://example.com",
                    redirect_uris: "https://example.com",
                    scopes: "read write",
                }),
            }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");

        const json = await response.json();

        expect(json).toEqual({
            id: expect.any(String),
            name: "Test Application",
            website: "https://example.com",
            client_id: expect.any(String),
            client_secret: expect.any(String),
            redirect_uri: "https://example.com",
            vapid_link: null,
        });

        client_id = json.client_id;
        client_secret = json.client_secret;
    });
});

describe("POST /api/auth/login/", () => {
    test("should get a JWT", async () => {
        const formData = new FormData();

        formData.append("identifier", users[0]?.getUser().email ?? "");
        formData.append("password", passwords[0]);

        const response = await sendTestRequest(
            new Request(
                new URL(
                    `/api/auth/login?client_id=${client_id}&redirect_uri=https://example.com&response_type=code&scope=read+write`,
                    base_url,
                ),
                {
                    method: "POST",
                    body: formData,
                },
            ),
        );

        expect(response.status).toBe(302);

        jwt =
            response.headers.get("Set-Cookie")?.match(/jwt=([^;]+);/)?.[1] ??
            "";
    });
});

describe("GET /oauth/authorize/", () => {
    test("should get a code", async () => {
        const response = await sendTestRequest(
            new Request(new URL("/oauth/authorize", base_url), {
                method: "POST",
                headers: {
                    Cookie: `jwt=${jwt}`,
                },
                body: new URLSearchParams({
                    client_id,
                    client_secret,
                    redirect_uri: "https://example.com",
                    response_type: "code",
                    scope: "read write",
                    max_age: "604800",
                }),
            }),
        );

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBeDefined();
        const locationHeader = new URL(
            response.headers.get("Location") ?? "",
            "",
        );

        expect(locationHeader.origin).toBe("https://example.com");

        code = locationHeader.searchParams.get("code") ?? "";
    });
});

describe("POST /oauth/token/", () => {
    test("should get an access token", async () => {
        const response = await sendTestRequest(
            new Request(wrapRelativeUrl("/oauth/token", base_url), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${jwt}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: "https://example.com",
                    client_id,
                    client_secret,
                    scope: "read write",
                }),
            }),
        );

        const json = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(json).toEqual({
            access_token: expect.any(String),
            token_type: "Bearer",
            scope: "read write",
            created_at: expect.any(Number),
            expires_in: expect.any(Number),
            id_token: null,
            refresh_token: null,
        });

        token = json;
    });
});

describe("GET /api/v1/apps/verify_credentials", () => {
    test("should return the authenticated application's credentials", async () => {
        const response = await sendTestRequest(
            new Request(
                wrapRelativeUrl("/api/v1/apps/verify_credentials", base_url),
                {
                    headers: {
                        Authorization: `Bearer ${token.access_token}`,
                    },
                },
            ),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");

        const credentials = (await response.json()) as Partial<APIApplication>;

        expect(credentials.name).toBe("Test Application");
        expect(credentials.website).toBe("https://example.com");
    });
});
