import { init } from '../serverless.js';

export default init((() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["desktop-downloads.json","releases/.gitkeep","releases/README.md","releases/barbro-desktop-0.1.0-arm64.dmg"]),
	mimeTypes: {".json":"application/json",".md":"text/markdown",".dmg":"application/octet-stream"},
	_: {
		client: {start:"_app/immutable/entry/start.D5OKh_nC.js",app:"_app/immutable/entry/app.Dh3eWmcl.js",imports:["_app/immutable/entry/start.D5OKh_nC.js","_app/immutable/chunks/C0VcY4m8.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BfKCCuky.js","_app/immutable/entry/app.Dh3eWmcl.js","_app/immutable/chunks/B64WrFVF.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BVEOzTpX.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:true},
		nodes: [
			__memo(() => import('../server/nodes/0.js')),
			__memo(() => import('../server/nodes/1.js')),
			__memo(() => import('../server/nodes/2.js')),
			__memo(() => import('../server/nodes/3.js')),
			__memo(() => import('../server/nodes/4.js')),
			__memo(() => import('../server/nodes/5.js')),
			__memo(() => import('../server/nodes/6.js')),
			__memo(() => import('../server/nodes/7.js')),
			__memo(() => import('../server/nodes/8.js')),
			__memo(() => import('../server/nodes/9.js')),
			__memo(() => import('../server/nodes/10.js')),
			__memo(() => import('../server/nodes/11.js')),
			__memo(() => import('../server/nodes/12.js')),
			__memo(() => import('../server/nodes/13.js')),
			__memo(() => import('../server/nodes/14.js'))
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
				id: "/account",
				pattern: /^\/account\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/admin/access",
				pattern: /^\/admin\/access\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/analyzing",
				pattern: /^\/analyzing\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/api/cloud/invites/mine",
				pattern: /^\/api\/cloud\/invites\/mine\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/invites/mine/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects",
				pattern: /^\/api\/cloud\/projects\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects/[id]",
				pattern: /^\/api\/cloud\/projects\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_id_/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects/[id]/members",
				pattern: /^\/api\/cloud\/projects\/([^/]+?)\/members\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_id_/members/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects/[id]/pending-invites",
				pattern: /^\/api\/cloud\/projects\/([^/]+?)\/pending-invites\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_id_/pending-invites/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects/[id]/songs",
				pattern: /^\/api\/cloud\/projects\/([^/]+?)\/songs\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_id_/songs/_server.ts.js'))
			},
			{
				id: "/api/cloud/projects/[id]/songs/[songId]",
				pattern: /^\/api\/cloud\/projects\/([^/]+?)\/songs\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false},{"name":"songId","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/cloud/projects/_id_/songs/_songId_/_server.ts.js'))
			},
			{
				id: "/api/health",
				pattern: /^\/api\/health\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/api/health/_server.ts.js'))
			},
			{
				id: "/auth/callback",
				pattern: /^\/auth\/callback\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/auth/callback/_server.ts.js'))
			},
			{
				id: "/debug/typography",
				pattern: /^\/debug\/typography\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/download",
				pattern: /^\/download\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/edit",
				pattern: /^\/edit\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/login",
				pattern: /^\/login\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/logout",
				pattern: /^\/logout\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../server/entries/endpoints/logout/_server.ts.js'))
			},
			{
				id: "/pending",
				pattern: /^\/pending\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/project",
				pattern: /^\/project\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/set",
				pattern: /^\/set\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/texttospeech",
				pattern: /^\/texttospeech\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 13 },
				endpoint: null
			},
			{
				id: "/welcome",
				pattern: /^\/welcome\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 14 },
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
})());

export const config = {
	path: ["/*"],
	excludedPath: ["/.netlify/*"],
	preferStatic: true
};
