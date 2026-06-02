
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/analyzing" | "/api" | "/api/health" | "/api/projects" | "/api/projects/[id]" | "/api/sessions" | "/api/sessions/ensure" | "/api/sessions/[id]" | "/download" | "/edit" | "/project" | "/set" | "/texttospeech";
		RouteParams(): {
			"/api/projects/[id]": { id: string };
			"/api/sessions/[id]": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/analyzing": Record<string, never>;
			"/api": { id?: string };
			"/api/health": Record<string, never>;
			"/api/projects": { id?: string };
			"/api/projects/[id]": { id: string };
			"/api/sessions": { id?: string };
			"/api/sessions/ensure": Record<string, never>;
			"/api/sessions/[id]": { id: string };
			"/download": Record<string, never>;
			"/edit": Record<string, never>;
			"/project": Record<string, never>;
			"/set": Record<string, never>;
			"/texttospeech": Record<string, never>
		};
		Pathname(): "/" | "/analyzing" | "/api/health" | "/api/projects" | `/api/projects/${string}` & {} | "/api/sessions/ensure" | `/api/sessions/${string}` & {} | "/download" | "/edit" | "/project" | "/set" | "/texttospeech";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/desktop-downloads.json" | "/releases/.gitkeep" | "/releases/README.md" | "/releases/barbro-desktop-0.1.0-arm64.dmg" | string & {};
	}
}