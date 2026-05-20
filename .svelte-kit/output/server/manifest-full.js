export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["desktop-downloads.json","releases/.gitkeep","releases/README.md","releases/barbro-desktop-0.1.0-arm64.dmg","vendor/lame.min.js"]),
	mimeTypes: {".json":"application/json",".md":"text/markdown",".dmg":"application/octet-stream",".js":"text/javascript"},
	_: {
		client: {start:"_app/immutable/entry/start.CR0YItDz.js",app:"_app/immutable/entry/app.CSIeeDAY.js",imports:["_app/immutable/entry/start.CR0YItDz.js","_app/immutable/chunks/C7tByMZB.js","_app/immutable/chunks/Dg0BMDbX.js","_app/immutable/chunks/DMpSmtiB.js","_app/immutable/chunks/DUgX7ckJ.js","_app/immutable/entry/app.CSIeeDAY.js","_app/immutable/chunks/CbUDssf9.js","_app/immutable/chunks/Dg0BMDbX.js","_app/immutable/chunks/DMpSmtiB.js","_app/immutable/chunks/D9FQP20W.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/8.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/analyzing",
				pattern: /^\/analyzing\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/api/analyze",
				pattern: /^\/api\/analyze\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/analyze/_server.ts.js'))
			},
			{
				id: "/api/health",
				pattern: /^\/api\/health\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/health/_server.ts.js'))
			},
			{
				id: "/api/projects",
				pattern: /^\/api\/projects\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/projects/_server.ts.js'))
			},
			{
				id: "/api/projects/[id]",
				pattern: /^\/api\/projects\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/projects/_id_/_server.ts.js'))
			},
			{
				id: "/api/projects/[id]/audio",
				pattern: /^\/api\/projects\/([^/]+?)\/audio\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/projects/_id_/audio/_server.ts.js'))
			},
			{
				id: "/api/sessions/ensure",
				pattern: /^\/api\/sessions\/ensure\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/sessions/ensure/_server.ts.js'))
			},
			{
				id: "/api/sessions/[id]",
				pattern: /^\/api\/sessions\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/sessions/_id_/_server.ts.js'))
			},
			{
				id: "/api/sessions/[id]/audio",
				pattern: /^\/api\/sessions\/([^/]+?)\/audio\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/sessions/_id_/audio/_server.ts.js'))
			},
			{
				id: "/download",
				pattern: /^\/download\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/edit",
				pattern: /^\/edit\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/project",
				pattern: /^\/project\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/set",
				pattern: /^\/set\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/texttospeech",
				pattern: /^\/texttospeech\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
