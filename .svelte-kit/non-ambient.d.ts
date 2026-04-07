
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
		RouteId(): "/" | "/api" | "/api/analyze" | "/api/health" | "/api/sessions" | "/api/sessions/ensure" | "/api/sessions/[id]" | "/api/sessions/[id]/audio" | "/edit";
		RouteParams(): {
			"/api/sessions/[id]": { id: string };
			"/api/sessions/[id]/audio": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/api": { id?: string };
			"/api/analyze": Record<string, never>;
			"/api/health": Record<string, never>;
			"/api/sessions": { id?: string };
			"/api/sessions/ensure": Record<string, never>;
			"/api/sessions/[id]": { id: string };
			"/api/sessions/[id]/audio": { id: string };
			"/edit": Record<string, never>
		};
		Pathname(): "/" | "/api/analyze" | "/api/health" | "/api/sessions/ensure" | `/api/sessions/${string}` & {} | `/api/sessions/${string}/` & {} | `/api/sessions/${string}/audio` & {} | "/edit";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/vendor/lame.min.js" | string & {};
	}
}