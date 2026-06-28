import "./index-server.js";
import { A as escape_html, F as writable, N as get$1, O as attr, a as derived, f as spread_props, i as bind_props, l as props_id, r as attributes } from "./server.js";
import "./index-server2.js";
import "./navigation.js";
import { n as cn, t as Button } from "./button.js";
import { A as cssToStyleObj, C as attachRef, D as Context, E as watch, M as boxWith, N as simpleBox, O as mergeProps, S as isNotNull, T as ElementSize, _ as MenuRootState, a as Dialog_title, b as createId, c as useId, d as Escape_layer, f as Dismissible_layer, g as MenuMenuState, h as MenuItemState, j as boxFrom, k as styleToString, l as Text_selection_layer, m as MenuContentState, n as Dialog_content, o as Dialog, p as DropdownMenuTriggerState, r as Dialog_header, s as Scroll_lock, u as Focus_scope, v as MenuSeparatorState, w as getWindow, x as noop$1, y as Portal } from "./dialog.js";
import { t as Icon } from "./Icon.js";
import { m as pickFolderViaDesktop } from "./desktopBridge.js";
import { b as setActiveProject, g as writeLastProjectPath, l as recordRecentProjectPath, m as songFolderName, nt as PROJECT_SONGS_DIR, o as metadataLiteFromSongMap, v as patchMetadataForFolder, x as setProjectData, y as project } from "./commit.js";
import { i as encodeSmapFile, r as decodeSmapFile } from "./smapFile.js";
import { a as readProjectSong, f as writeProjectManifest, n as createProjectSong, t as createProject } from "./desktopProjectFs2.js";
import { n as toCollabSongMap } from "./collab2.js";
import { arrow, autoUpdate, computePosition, flip, hide, limitShift, offset, shift, size } from "@floating-ui/dom";
//#region node_modules/bits-ui/dist/internal/floating-svelte/floating-utils.svelte.js
function get(valueOrGetValue) {
	return typeof valueOrGetValue === "function" ? valueOrGetValue() : valueOrGetValue;
}
function getDPR(element) {
	if (typeof window === "undefined") return 1;
	return (element.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function roundByDPR(element, value) {
	const dpr = getDPR(element);
	return Math.round(value * dpr) / dpr;
}
function getFloatingContentCSSVars(name) {
	return {
		[`--bits-${name}-content-transform-origin`]: `var(--bits-floating-transform-origin)`,
		[`--bits-${name}-content-available-width`]: `var(--bits-floating-available-width)`,
		[`--bits-${name}-content-available-height`]: `var(--bits-floating-available-height)`,
		[`--bits-${name}-anchor-width`]: `var(--bits-floating-anchor-width)`,
		[`--bits-${name}-anchor-height`]: `var(--bits-floating-anchor-height)`
	};
}
//#endregion
//#region node_modules/bits-ui/dist/internal/floating-svelte/use-floating.svelte.js
function useFloating(options) {
	options.whileElementsMounted;
	const openOption = derived(() => get(options.open) ?? true);
	const middlewareOption = derived(() => get(options.middleware));
	const transformOption = derived(() => get(options.transform) ?? true);
	const placementOption = derived(() => get(options.placement) ?? "bottom");
	const strategyOption = derived(() => get(options.strategy) ?? "absolute");
	const sideOffsetOption = derived(() => get(options.sideOffset) ?? 0);
	const alignOffsetOption = derived(() => get(options.alignOffset) ?? 0);
	const reference = options.reference;
	/** State */
	let x = 0;
	let y = 0;
	const floating = simpleBox(null);
	let strategy = strategyOption();
	let placement = placementOption();
	let middlewareData = {};
	let isPositioned = false;
	let updateRequestId = 0;
	const floatingStyles = derived(() => {
		const xVal = floating.current ? roundByDPR(floating.current, x) : x;
		const yVal = floating.current ? roundByDPR(floating.current, y) : y;
		if (transformOption()) return {
			position: strategy,
			left: "0",
			top: "0",
			transform: `translate(${xVal}px, ${yVal}px)`,
			...floating.current && getDPR(floating.current) >= 1.5 && { willChange: "transform" }
		};
		return {
			position: strategy,
			left: `${xVal}px`,
			top: `${yVal}px`
		};
	});
	function update() {
		if (reference.current === null || floating.current === null) return;
		const referenceNode = reference.current;
		const floatingNode = floating.current;
		const requestId = ++updateRequestId;
		computePosition(referenceNode, floatingNode, {
			middleware: middlewareOption(),
			placement: placementOption(),
			strategy: strategyOption()
		}).then((position) => {
			if (requestId !== updateRequestId) return;
			if (reference.current !== referenceNode || floating.current !== floatingNode) return;
			if (isReferenceHidden(referenceNode)) {
				middlewareData = {
					...middlewareData,
					hide: {
						...middlewareData.hide,
						referenceHidden: true
					}
				};
				return;
			}
			if (!openOption() && x !== 0 && y !== 0) {
				const maxExpectedOffset = Math.max(Math.abs(sideOffsetOption()), Math.abs(alignOffsetOption()), 15);
				if (position.x <= maxExpectedOffset && position.y <= maxExpectedOffset) return;
			}
			x = position.x;
			y = position.y;
			strategy = position.strategy;
			placement = position.placement;
			middlewareData = position.middlewareData;
			isPositioned = true;
		});
	}
	return {
		floating,
		reference,
		get strategy() {
			return strategy;
		},
		get placement() {
			return placement;
		},
		get middlewareData() {
			return middlewareData;
		},
		get isPositioned() {
			return isPositioned;
		},
		get floatingStyles() {
			return floatingStyles();
		},
		get update() {
			return update;
		}
	};
}
function isReferenceHidden(node) {
	if (!(node instanceof Element)) return false;
	if (!node.isConnected) return true;
	if (node instanceof HTMLElement && node.hidden) return true;
	return node.getClientRects().length === 0;
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/floating-layer/use-floating-layer.svelte.js
var OPPOSITE_SIDE = {
	top: "bottom",
	right: "left",
	bottom: "top",
	left: "right"
};
var FloatingRootContext = new Context("Floating.Root");
var FloatingContentContext = new Context("Floating.Content");
var FloatingTooltipRootContext = new Context("Floating.Root");
var FloatingRootState = class FloatingRootState {
	static create(tooltip = false) {
		return tooltip ? FloatingTooltipRootContext.set(new FloatingRootState()) : FloatingRootContext.set(new FloatingRootState());
	}
	anchorNode = simpleBox(null);
	customAnchorNode = simpleBox(null);
	triggerNode = simpleBox(null);
	constructor() {}
};
var FloatingContentState = class FloatingContentState {
	static create(opts, tooltip = false) {
		return tooltip ? FloatingContentContext.set(new FloatingContentState(opts, FloatingTooltipRootContext.get())) : FloatingContentContext.set(new FloatingContentState(opts, FloatingRootContext.get()));
	}
	opts;
	root;
	contentRef = simpleBox(null);
	wrapperRef = simpleBox(null);
	arrowRef = simpleBox(null);
	contentAttachment = attachRef(this.contentRef);
	wrapperAttachment = attachRef(this.wrapperRef);
	arrowAttachment = attachRef(this.arrowRef);
	arrowId = simpleBox(useId());
	#transformedStyle = derived(() => {
		if (typeof this.opts.style === "string") return cssToStyleObj(this.opts.style);
		if (!this.opts.style) return {};
	});
	#updatePositionStrategy = void 0;
	#arrowSize = new ElementSize(() => this.arrowRef.current ?? void 0);
	#arrowWidth = derived(() => this.#arrowSize?.width ?? 0);
	#arrowHeight = derived(() => this.#arrowSize?.height ?? 0);
	#desiredPlacement = derived(() => this.opts.side?.current + (this.opts.align.current !== "center" ? `-${this.opts.align.current}` : ""));
	#boundary = derived(() => Array.isArray(this.opts.collisionBoundary.current) ? this.opts.collisionBoundary.current : [this.opts.collisionBoundary.current]);
	#hasExplicitBoundaries = derived(() => this.#boundary().length > 0);
	get hasExplicitBoundaries() {
		return this.#hasExplicitBoundaries();
	}
	set hasExplicitBoundaries($$value) {
		return this.#hasExplicitBoundaries($$value);
	}
	#detectOverflowOptions = derived(() => ({
		padding: this.opts.collisionPadding.current,
		boundary: this.#boundary().filter(isNotNull),
		altBoundary: this.hasExplicitBoundaries
	}));
	get detectOverflowOptions() {
		return this.#detectOverflowOptions();
	}
	set detectOverflowOptions($$value) {
		return this.#detectOverflowOptions($$value);
	}
	#availableWidth = void 0;
	#availableHeight = void 0;
	#anchorWidth = void 0;
	#anchorHeight = void 0;
	#middleware = derived(() => [
		offset({
			mainAxis: this.opts.sideOffset.current + this.#arrowHeight(),
			alignmentAxis: this.opts.alignOffset.current
		}),
		this.opts.avoidCollisions.current && shift({
			mainAxis: true,
			crossAxis: false,
			limiter: this.opts.sticky.current === "partial" ? limitShift() : void 0,
			...this.detectOverflowOptions
		}),
		this.opts.avoidCollisions.current && flip({ ...this.detectOverflowOptions }),
		size({
			...this.detectOverflowOptions,
			apply: ({ rects, availableWidth, availableHeight }) => {
				const { width: anchorWidth, height: anchorHeight } = rects.reference;
				this.#availableWidth = availableWidth;
				this.#availableHeight = availableHeight;
				this.#anchorWidth = anchorWidth;
				this.#anchorHeight = anchorHeight;
			}
		}),
		this.arrowRef.current && arrow({
			element: this.arrowRef.current,
			padding: this.opts.arrowPadding.current
		}),
		transformOrigin({
			arrowWidth: this.#arrowWidth(),
			arrowHeight: this.#arrowHeight()
		}),
		this.opts.hideWhenDetached.current && hide({
			strategy: "referenceHidden",
			...this.detectOverflowOptions
		})
	].filter(Boolean));
	get middleware() {
		return this.#middleware();
	}
	set middleware($$value) {
		return this.#middleware($$value);
	}
	floating;
	#placedSide = derived(() => getSideFromPlacement(this.floating.placement));
	get placedSide() {
		return this.#placedSide();
	}
	set placedSide($$value) {
		return this.#placedSide($$value);
	}
	#placedAlign = derived(() => getAlignFromPlacement(this.floating.placement));
	get placedAlign() {
		return this.#placedAlign();
	}
	set placedAlign($$value) {
		return this.#placedAlign($$value);
	}
	#arrowX = derived(() => this.floating.middlewareData.arrow?.x ?? 0);
	get arrowX() {
		return this.#arrowX();
	}
	set arrowX($$value) {
		return this.#arrowX($$value);
	}
	#arrowY = derived(() => this.floating.middlewareData.arrow?.y ?? 0);
	get arrowY() {
		return this.#arrowY();
	}
	set arrowY($$value) {
		return this.#arrowY($$value);
	}
	#cannotCenterArrow = derived(() => this.floating.middlewareData.arrow?.centerOffset !== 0);
	get cannotCenterArrow() {
		return this.#cannotCenterArrow();
	}
	set cannotCenterArrow($$value) {
		return this.#cannotCenterArrow($$value);
	}
	contentZIndex;
	#arrowBaseSide = derived(() => OPPOSITE_SIDE[this.placedSide]);
	get arrowBaseSide() {
		return this.#arrowBaseSide();
	}
	set arrowBaseSide($$value) {
		return this.#arrowBaseSide($$value);
	}
	#wrapperProps = derived(() => ({
		id: this.opts.wrapperId.current,
		"data-bits-floating-content-wrapper": "",
		style: {
			...this.floating.floatingStyles,
			transform: this.floating.isPositioned ? this.floating.floatingStyles.transform : "translate(0, -200%)",
			minWidth: "max-content",
			zIndex: this.contentZIndex,
			"--bits-floating-transform-origin": `${this.floating.middlewareData.transformOrigin?.x} ${this.floating.middlewareData.transformOrigin?.y}`,
			"--bits-floating-available-width": `${this.#availableWidth}px`,
			"--bits-floating-available-height": `${this.#availableHeight}px`,
			"--bits-floating-anchor-width": `${this.#anchorWidth}px`,
			"--bits-floating-anchor-height": `${this.#anchorHeight}px`,
			...this.floating.middlewareData.hide?.referenceHidden && {
				visibility: "hidden",
				"pointer-events": "none"
			},
			...this.#transformedStyle()
		},
		dir: this.opts.dir.current,
		...this.wrapperAttachment
	}));
	get wrapperProps() {
		return this.#wrapperProps();
	}
	set wrapperProps($$value) {
		return this.#wrapperProps($$value);
	}
	#props = derived(() => ({
		"data-side": this.placedSide,
		"data-align": this.placedAlign,
		style: styleToString({ ...this.#transformedStyle() }),
		...this.contentAttachment
	}));
	get props() {
		return this.#props();
	}
	set props($$value) {
		return this.#props($$value);
	}
	#arrowStyle = derived(() => ({
		position: "absolute",
		left: this.arrowX ? `${this.arrowX}px` : void 0,
		top: this.arrowY ? `${this.arrowY}px` : void 0,
		[this.arrowBaseSide]: 0,
		"transform-origin": {
			top: "",
			right: "0 0",
			bottom: "center 0",
			left: "100% 0"
		}[this.placedSide],
		transform: {
			top: "translateY(100%)",
			right: "translateY(50%) rotate(90deg) translateX(-50%)",
			bottom: "rotate(180deg)",
			left: "translateY(50%) rotate(-90deg) translateX(50%)"
		}[this.placedSide],
		visibility: this.cannotCenterArrow ? "hidden" : void 0
	}));
	get arrowStyle() {
		return this.#arrowStyle();
	}
	set arrowStyle($$value) {
		return this.#arrowStyle($$value);
	}
	constructor(opts, root) {
		this.opts = opts;
		this.root = root;
		this.#updatePositionStrategy = opts.updatePositionStrategy;
		if (opts.customAnchor) this.root.customAnchorNode.current = opts.customAnchor.current;
		watch(() => opts.customAnchor.current, (customAnchor) => {
			this.root.customAnchorNode.current = customAnchor;
		});
		this.floating = useFloating({
			strategy: () => this.opts.strategy.current,
			placement: () => this.#desiredPlacement(),
			middleware: () => this.middleware,
			reference: this.root.anchorNode,
			whileElementsMounted: (...args) => {
				return autoUpdate(...args, { animationFrame: this.#updatePositionStrategy?.current === "always" });
			},
			open: () => this.opts.enabled.current,
			sideOffset: () => this.opts.sideOffset.current,
			alignOffset: () => this.opts.alignOffset.current
		});
		watch(() => this.contentRef.current, (contentNode) => {
			if (!contentNode || !this.opts.enabled.current) return;
			const win = getWindow(contentNode);
			const rafId = win.requestAnimationFrame(() => {
				if (this.contentRef.current !== contentNode || !this.opts.enabled.current) return;
				const zIndex = win.getComputedStyle(contentNode).zIndex;
				if (zIndex !== this.contentZIndex) this.contentZIndex = zIndex;
			});
			return () => {
				win.cancelAnimationFrame(rafId);
			};
		});
	}
};
var FloatingAnchorState = class FloatingAnchorState {
	static create(opts, tooltip = false) {
		return tooltip ? new FloatingAnchorState(opts, FloatingTooltipRootContext.get()) : new FloatingAnchorState(opts, FloatingRootContext.get());
	}
	opts;
	root;
	constructor(opts, root) {
		this.opts = opts;
		this.root = root;
		if (opts.virtualEl && opts.virtualEl.current) root.triggerNode = boxFrom(opts.virtualEl.current);
		else root.triggerNode = opts.ref;
	}
};
function transformOrigin(options) {
	return {
		name: "transformOrigin",
		options,
		fn(data) {
			const { placement, rects, middlewareData } = data;
			const isArrowHidden = middlewareData.arrow?.centerOffset !== 0;
			const arrowWidth = isArrowHidden ? 0 : options.arrowWidth;
			const arrowHeight = isArrowHidden ? 0 : options.arrowHeight;
			const [placedSide, placedAlign] = getSideAndAlignFromPlacement(placement);
			const noArrowAlign = {
				start: "0%",
				center: "50%",
				end: "100%"
			}[placedAlign];
			const arrowXCenter = (middlewareData.arrow?.x ?? 0) + arrowWidth / 2;
			const arrowYCenter = (middlewareData.arrow?.y ?? 0) + arrowHeight / 2;
			let x = "";
			let y = "";
			if (placedSide === "bottom") {
				x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
				y = `${-arrowHeight}px`;
			} else if (placedSide === "top") {
				x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
				y = `${rects.floating.height + arrowHeight}px`;
			} else if (placedSide === "right") {
				x = `${-arrowHeight}px`;
				y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
			} else if (placedSide === "left") {
				x = `${rects.floating.width + arrowHeight}px`;
				y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
			}
			return { data: {
				x,
				y
			} };
		}
	};
}
function getSideAndAlignFromPlacement(placement) {
	const [side, align = "center"] = placement.split("-");
	return [side, align];
}
function getSideFromPlacement(placement) {
	return getSideAndAlignFromPlacement(placement)[0];
}
function getAlignFromPlacement(placement) {
	return getSideAndAlignFromPlacement(placement)[1];
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/floating-layer/components/floating-layer.svelte
function Floating_layer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { children, tooltip = false } = $$props;
		FloatingRootState.create(tooltip);
		children?.($$renderer);
		$$renderer.push(`<!---->`);
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/floating-layer/components/floating-layer-anchor.svelte
function Floating_layer_anchor($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { id, children, virtualEl, ref, tooltip = false } = $$props;
		FloatingAnchorState.create({
			id: boxWith(() => id),
			virtualEl: boxWith(() => virtualEl),
			ref
		}, tooltip);
		children?.($$renderer);
		$$renderer.push(`<!---->`);
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/floating-layer/components/floating-layer-content.svelte
function Floating_layer_content($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { content, side = "bottom", sideOffset = 0, align = "center", alignOffset = 0, id, arrowPadding = 0, avoidCollisions = true, collisionBoundary = [], collisionPadding = 0, hideWhenDetached = false, onPlaced = () => {}, sticky = "partial", updatePositionStrategy = "optimized", strategy = "fixed", dir = "ltr", style = {}, wrapperId = useId(), customAnchor = null, enabled, tooltip = false } = $$props;
		const contentState = FloatingContentState.create({
			side: boxWith(() => side),
			sideOffset: boxWith(() => sideOffset),
			align: boxWith(() => align),
			alignOffset: boxWith(() => alignOffset),
			id: boxWith(() => id),
			arrowPadding: boxWith(() => arrowPadding),
			avoidCollisions: boxWith(() => avoidCollisions),
			collisionBoundary: boxWith(() => collisionBoundary),
			collisionPadding: boxWith(() => collisionPadding),
			hideWhenDetached: boxWith(() => hideWhenDetached),
			onPlaced: boxWith(() => onPlaced),
			sticky: boxWith(() => sticky),
			updatePositionStrategy: boxWith(() => updatePositionStrategy),
			strategy: boxWith(() => strategy),
			dir: boxWith(() => dir),
			style: boxWith(() => style),
			enabled: boxWith(() => enabled),
			wrapperId: boxWith(() => wrapperId),
			customAnchor: boxWith(() => customAnchor)
		}, tooltip);
		const mergedProps = derived(() => mergeProps(contentState.wrapperProps, { style: { pointerEvents: "auto" } }));
		content?.($$renderer, {
			props: contentState.props,
			wrapperProps: mergedProps()
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/floating-layer/components/floating-layer-content-static.svelte
function Floating_layer_content_static($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { content, onPlaced } = $$props;
		content?.($$renderer, {
			props: {},
			wrapperProps: {}
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/popper-layer/popper-content.svelte
function Popper_content($$renderer, $$props) {
	let { content, isStatic = false, onPlaced, $$slots, $$events, ...restProps } = $$props;
	if (isStatic) {
		$$renderer.push("<!--[0-->");
		Floating_layer_content_static($$renderer, {
			content,
			onPlaced
		});
	} else {
		$$renderer.push("<!--[-1-->");
		Floating_layer_content($$renderer, spread_props([{
			content,
			onPlaced
		}, restProps]));
	}
	$$renderer.push(`<!--]-->`);
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/popper-layer/popper-layer-inner.svelte
function Popper_layer_inner($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { popper, onEscapeKeydown, escapeKeydownBehavior, preventOverflowTextSelection, id, onPointerDown, onPointerUp, side, sideOffset, align, alignOffset, arrowPadding, avoidCollisions, collisionBoundary, collisionPadding, sticky, hideWhenDetached, updatePositionStrategy, strategy, dir, preventScroll, wrapperId, style, onPlaced, onInteractOutside, onCloseAutoFocus, onOpenAutoFocus, onFocusOutside, interactOutsideBehavior = "close", loop, trapFocus = true, isValidEvent = () => false, customAnchor = null, isStatic = false, enabled, ref, tooltip = false, contentPointerEvents = "auto", $$slots, $$events, ...restProps } = $$props;
		const resolvedPreventScroll = derived(() => preventScroll ?? true);
		const effectiveStrategy = derived(() => strategy ?? (resolvedPreventScroll() ? "fixed" : "absolute"));
		{
			function content($$renderer, { props: floatingProps, wrapperProps }) {
				if (restProps.forceMount && enabled) {
					$$renderer.push("<!--[0-->");
					Scroll_lock($$renderer, { preventScroll: resolvedPreventScroll() });
				} else if (!restProps.forceMount) {
					$$renderer.push("<!--[1-->");
					Scroll_lock($$renderer, { preventScroll: resolvedPreventScroll() });
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				{
					function focusScope($$renderer, { props: focusScopeProps }) {
						Escape_layer($$renderer, {
							onEscapeKeydown,
							escapeKeydownBehavior,
							enabled,
							ref,
							children: ($$renderer) => {
								{
									function children($$renderer, { props: dismissibleProps }) {
										Text_selection_layer($$renderer, {
											id,
											preventOverflowTextSelection,
											onPointerDown,
											onPointerUp,
											enabled,
											ref,
											children: ($$renderer) => {
												popper?.($$renderer, {
													props: mergeProps(restProps, floatingProps, dismissibleProps, focusScopeProps, { style: { pointerEvents: contentPointerEvents } }),
													wrapperProps
												});
												$$renderer.push(`<!---->`);
											},
											$$slots: { default: true }
										});
									}
									Dismissible_layer($$renderer, {
										id,
										onInteractOutside,
										onFocusOutside,
										interactOutsideBehavior,
										isValidEvent,
										enabled,
										ref,
										children,
										$$slots: { default: true }
									});
								}
							},
							$$slots: { default: true }
						});
					}
					Focus_scope($$renderer, {
						onOpenAutoFocus,
						onCloseAutoFocus,
						loop,
						enabled,
						trapFocus,
						forceMount: restProps.forceMount,
						ref,
						focusScope,
						$$slots: { focusScope: true }
					});
				}
				$$renderer.push(`<!---->`);
			}
			Popper_content($$renderer, {
				isStatic,
				id,
				side,
				sideOffset,
				align,
				alignOffset,
				arrowPadding,
				avoidCollisions,
				collisionBoundary,
				collisionPadding,
				sticky,
				hideWhenDetached,
				updatePositionStrategy,
				strategy: effectiveStrategy(),
				dir,
				wrapperId,
				style,
				onPlaced,
				customAnchor,
				enabled,
				tooltip,
				content,
				$$slots: { content: true }
			});
		}
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/popper-layer/popper-layer.svelte
function Popper_layer($$renderer, $$props) {
	let { popper, open, onEscapeKeydown, escapeKeydownBehavior, preventOverflowTextSelection, id, onPointerDown, onPointerUp, side, sideOffset, align, alignOffset, arrowPadding, avoidCollisions, collisionBoundary, collisionPadding, sticky, hideWhenDetached, updatePositionStrategy, strategy, dir, preventScroll, wrapperId, style, onPlaced, onInteractOutside, onCloseAutoFocus, onOpenAutoFocus, onFocusOutside, interactOutsideBehavior = "close", loop, trapFocus = true, isValidEvent = () => false, customAnchor = null, isStatic = false, ref, shouldRender, $$slots, $$events, ...restProps } = $$props;
	if (shouldRender) {
		$$renderer.push("<!--[0-->");
		Popper_layer_inner($$renderer, spread_props([{
			popper,
			onEscapeKeydown,
			escapeKeydownBehavior,
			preventOverflowTextSelection,
			id,
			onPointerDown,
			onPointerUp,
			side,
			sideOffset,
			align,
			alignOffset,
			arrowPadding,
			avoidCollisions,
			collisionBoundary,
			collisionPadding,
			sticky,
			hideWhenDetached,
			updatePositionStrategy,
			strategy,
			dir,
			preventScroll,
			wrapperId,
			style,
			onPlaced,
			customAnchor,
			isStatic,
			enabled: open,
			onInteractOutside,
			onCloseAutoFocus,
			onOpenAutoFocus,
			interactOutsideBehavior,
			loop,
			trapFocus,
			isValidEvent,
			onFocusOutside,
			forceMount: false,
			ref
		}, restProps]));
	} else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]-->`);
}
//#endregion
//#region node_modules/bits-ui/dist/bits/utilities/popper-layer/popper-layer-force-mount.svelte
function Popper_layer_force_mount($$renderer, $$props) {
	let { popper, onEscapeKeydown, escapeKeydownBehavior, preventOverflowTextSelection, id, onPointerDown, onPointerUp, side, sideOffset, align, alignOffset, arrowPadding, avoidCollisions, collisionBoundary, collisionPadding, sticky, hideWhenDetached, updatePositionStrategy, strategy, dir, preventScroll, wrapperId, style, onPlaced, onInteractOutside, onCloseAutoFocus, onOpenAutoFocus, onFocusOutside, interactOutsideBehavior = "close", loop, trapFocus = true, isValidEvent = () => false, customAnchor = null, isStatic = false, enabled, $$slots, $$events, ...restProps } = $$props;
	Popper_layer_inner($$renderer, spread_props([
		{
			popper,
			onEscapeKeydown,
			escapeKeydownBehavior,
			preventOverflowTextSelection,
			id,
			onPointerDown,
			onPointerUp,
			side,
			sideOffset,
			align,
			alignOffset,
			arrowPadding,
			avoidCollisions,
			collisionBoundary,
			collisionPadding,
			sticky,
			hideWhenDetached,
			updatePositionStrategy,
			strategy,
			dir,
			preventScroll,
			wrapperId,
			style,
			onPlaced,
			customAnchor,
			isStatic,
			enabled,
			onInteractOutside,
			onCloseAutoFocus,
			onOpenAutoFocus,
			interactOutsideBehavior,
			loop,
			trapFocus,
			isValidEvent,
			onFocusOutside
		},
		restProps,
		{ forceMount: true }
	]));
}
//#endregion
//#region node_modules/bits-ui/dist/bits/menu/components/menu-item.svelte
function Menu_item($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { child, children, ref = null, id = createId(uid), disabled = false, onSelect = noop$1, closeOnSelect = true, $$slots, $$events, ...restProps } = $$props;
		const itemState = MenuItemState.create({
			id: boxWith(() => id),
			disabled: boxWith(() => disabled),
			onSelect: boxWith(() => onSelect),
			ref: boxWith(() => ref, (v) => ref = v),
			closeOnSelect: boxWith(() => closeOnSelect)
		});
		const mergedProps = derived(() => mergeProps(restProps, itemState.props));
		if (child) {
			$$renderer.push("<!--[0-->");
			child($$renderer, { props: mergedProps() });
			$$renderer.push(`<!---->`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div${attributes({ ...mergedProps() })}>`);
			children?.($$renderer);
			$$renderer.push(`<!----></div>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/menu/components/menu-separator.svelte
function Menu_separator($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { ref = null, id = createId(uid), child, children, $$slots, $$events, ...restProps } = $$props;
		const separatorState = MenuSeparatorState.create({
			id: boxWith(() => id),
			ref: boxWith(() => ref, (v) => ref = v)
		});
		const mergedProps = derived(() => mergeProps(restProps, separatorState.props));
		if (child) {
			$$renderer.push("<!--[0-->");
			child($$renderer, { props: mergedProps() });
			$$renderer.push(`<!---->`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div${attributes({ ...mergedProps() })}>`);
			children?.($$renderer);
			$$renderer.push(`<!----></div>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/menu/components/menu.svelte
function Menu($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false, dir = "ltr", onOpenChange = noop$1, onOpenChangeComplete = noop$1, _internal_variant: variant = "dropdown-menu", children } = $$props;
		const root = MenuRootState.create({
			variant: boxWith(() => variant),
			dir: boxWith(() => dir),
			onClose: () => {
				open = false;
				onOpenChange(false);
			}
		});
		MenuMenuState.create({
			open: boxWith(() => open, (v) => {
				open = v;
				onOpenChange(v);
			}),
			onOpenChangeComplete: boxWith(() => onOpenChangeComplete)
		}, root);
		Floating_layer($$renderer, {
			children: ($$renderer) => {
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		});
		bind_props($$props, { open });
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/dropdown-menu/components/dropdown-menu-content.svelte
function Dropdown_menu_content$1($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { id = createId(uid), child, children, ref = null, loop = true, onInteractOutside = noop$1, onEscapeKeydown = noop$1, onCloseAutoFocus = noop$1, forceMount = false, trapFocus = false, style, $$slots, $$events, ...restProps } = $$props;
		const contentState = MenuContentState.create({
			id: boxWith(() => id),
			loop: boxWith(() => loop),
			ref: boxWith(() => ref, (v) => ref = v),
			onCloseAutoFocus: boxWith(() => onCloseAutoFocus)
		});
		const mergedProps = derived(() => mergeProps(restProps, contentState.props));
		function handleInteractOutside(e) {
			contentState.handleInteractOutside(e);
			if (e.defaultPrevented) return;
			onInteractOutside(e);
			if (e.defaultPrevented) return;
			if (e.target && e.target instanceof Element) {
				const subContentSelector = `[${contentState.parentMenu.root.getBitsAttr("sub-content")}]`;
				if (e.target.closest(subContentSelector)) return;
			}
			contentState.parentMenu.onClose();
		}
		function handleEscapeKeydown(e) {
			onEscapeKeydown(e);
			if (e.defaultPrevented) return;
			contentState.parentMenu.onClose();
		}
		if (forceMount) {
			$$renderer.push("<!--[0-->");
			{
				function popper($$renderer, { props, wrapperProps }) {
					const finalProps = mergeProps(props, { style: getFloatingContentCSSVars("dropdown-menu") }, { style });
					if (child) {
						$$renderer.push("<!--[0-->");
						child($$renderer, {
							props: finalProps,
							wrapperProps,
							...contentState.snippetProps
						});
						$$renderer.push(`<!---->`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`<div${attributes({ ...wrapperProps })}><div${attributes({ ...finalProps })}>`);
						children?.($$renderer);
						$$renderer.push(`<!----></div></div>`);
					}
					$$renderer.push(`<!--]-->`);
				}
				Popper_layer_force_mount($$renderer, spread_props([
					mergedProps(),
					contentState.popperProps,
					{
						ref: contentState.opts.ref,
						enabled: contentState.parentMenu.opts.open.current,
						onInteractOutside: handleInteractOutside,
						onEscapeKeydown: handleEscapeKeydown,
						trapFocus,
						loop,
						forceMount: true,
						id,
						shouldRender: contentState.shouldRender,
						popper,
						$$slots: { popper: true }
					}
				]));
			}
		} else if (!forceMount) {
			$$renderer.push("<!--[1-->");
			{
				function popper($$renderer, { props, wrapperProps }) {
					const finalProps = mergeProps(props, { style: getFloatingContentCSSVars("dropdown-menu") }, { style });
					if (child) {
						$$renderer.push("<!--[0-->");
						child($$renderer, {
							props: finalProps,
							wrapperProps,
							...contentState.snippetProps
						});
						$$renderer.push(`<!---->`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`<div${attributes({ ...wrapperProps })}><div${attributes({ ...finalProps })}>`);
						children?.($$renderer);
						$$renderer.push(`<!----></div></div>`);
					}
					$$renderer.push(`<!--]-->`);
				}
				Popper_layer($$renderer, spread_props([
					mergedProps(),
					contentState.popperProps,
					{
						ref: contentState.opts.ref,
						open: contentState.parentMenu.opts.open.current,
						onInteractOutside: handleInteractOutside,
						onEscapeKeydown: handleEscapeKeydown,
						trapFocus,
						loop,
						forceMount: false,
						id,
						shouldRender: contentState.shouldRender,
						popper,
						$$slots: { popper: true }
					}
				]));
			}
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region node_modules/bits-ui/dist/bits/menu/components/menu-trigger.svelte
function Menu_trigger($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const uid = props_id($$renderer);
		let { id = createId(uid), ref = null, child, children, disabled = false, type = "button", $$slots, $$events, ...restProps } = $$props;
		const triggerState = DropdownMenuTriggerState.create({
			id: boxWith(() => id),
			disabled: boxWith(() => disabled ?? false),
			ref: boxWith(() => ref, (v) => ref = v)
		});
		const mergedProps = derived(() => mergeProps(restProps, triggerState.props, { type }));
		Floating_layer_anchor($$renderer, {
			id,
			ref: triggerState.opts.ref,
			children: ($$renderer) => {
				if (child) {
					$$renderer.push("<!--[0-->");
					child($$renderer, { props: mergedProps() });
					$$renderer.push(`<!---->`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<button${attributes({ ...mergedProps() })}>`);
					children?.($$renderer);
					$$renderer.push(`<!----></button>`);
				}
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		});
		bind_props($$props, { ref });
	});
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu.svelte
function Dropdown_menu($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false, $$slots, $$events, ...restProps } = $$props;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (Menu) {
				$$renderer.push("<!--[-->");
				Menu($$renderer, spread_props([restProps, {
					get open() {
						return open;
					},
					set open($$value) {
						open = $$value;
						$$settled = false;
					}
				}]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu-portal.svelte
function Dropdown_menu_portal($$renderer, $$props) {
	let { $$slots, $$events, ...restProps } = $$props;
	if (Portal) {
		$$renderer.push("<!--[-->");
		Portal($$renderer, spread_props([restProps]));
		$$renderer.push("<!--]-->");
	} else {
		$$renderer.push("<!--[!-->");
		$$renderer.push("<!--]-->");
	}
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu-content.svelte
function Dropdown_menu_content($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ref = null, sideOffset = 4, align = "start", portalProps = {}, class: className, $$slots, $$events, ...restProps } = $$props;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dropdown_menu_portal($$renderer, spread_props([portalProps, {
				children: ($$renderer) => {
					if (Dropdown_menu_content$1) {
						$$renderer.push("<!--[-->");
						Dropdown_menu_content$1($$renderer, spread_props([
							{
								"data-slot": "dropdown-menu-content",
								sideOffset,
								align,
								class: cn("brutalist-shadow-sm data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 bg-popover text-popover-foreground min-w-32 rounded-[var(--radius)] border-2 border-foreground p-1 duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 z-50 w-(--bits-dropdown-menu-anchor-width) overflow-x-hidden overflow-y-auto outline-none data-closed:overflow-hidden", className)
							},
							restProps,
							{
								get ref() {
									return ref;
								},
								set ref($$value) {
									ref = $$value;
									$$settled = false;
								}
							}
						]));
						$$renderer.push("<!--]-->");
					} else {
						$$renderer.push("<!--[!-->");
						$$renderer.push("<!--]-->");
					}
				},
				$$slots: { default: true }
			}]));
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu-item.svelte
function Dropdown_menu_item($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ref = null, class: className, inset = false, variant = "default", $$slots, $$events, ...restProps } = $$props;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (Menu_item) {
				$$renderer.push("<!--[-->");
				Menu_item($$renderer, spread_props([
					{
						"data-slot": "dropdown-menu-item",
						"data-inset": inset ? "" : void 0,
						"data-variant": variant,
						class: cn("focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive not-data-[variant=destructive]:focus:**:text-accent-foreground gap-1.5 rounded-[var(--radius)] px-2 py-1 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 group/dropdown-menu-item relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0", className)
					},
					restProps,
					{
						get ref() {
							return ref;
						},
						set ref($$value) {
							ref = $$value;
							$$settled = false;
						}
					}
				]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu-separator.svelte
function Dropdown_menu_separator($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ref = null, class: className, $$slots, $$events, ...restProps } = $$props;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (Menu_separator) {
				$$renderer.push("<!--[-->");
				Menu_separator($$renderer, spread_props([
					{
						"data-slot": "dropdown-menu-separator",
						class: cn("bg-border -mx-1 my-1 h-px", className)
					},
					restProps,
					{
						get ref() {
							return ref;
						},
						set ref($$value) {
							ref = $$value;
							$$settled = false;
						}
					}
				]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region src/lib/components/ui/dropdown-menu/dropdown-menu-trigger.svelte
function Dropdown_menu_trigger($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ref = null, $$slots, $$events, ...restProps } = $$props;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (Menu_trigger) {
				$$renderer.push("<!--[-->");
				Menu_trigger($$renderer, spread_props([
					{ "data-slot": "dropdown-menu-trigger" },
					restProps,
					{
						get ref() {
							return ref;
						},
						set ref($$value) {
							ref = $$value;
							$$settled = false;
						}
					}
				]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region src/lib/components/NewProjectDialog.svelte
function NewProjectDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Self-contained "New project" dialog used by the File menu and the
		* `/project` empty-state landing. Owns its own name/folder/error state
		* so callers only need a bindable `open` flag plus an optional
		* `onCreated` callback. The dialog handles navigating to `/project`
		* itself when the create succeeds.
		*
		* Native picker is triggered from a button INSIDE the dialog, never
		* from a dropdown's click — the latter chains a synchronous dropdown
		* close with an async picker call and gets suppressed in some browsers
		* (Safari especially). Open dialog first, then picker.
		*/
		let { open = false, onCreated } = $$props;
		/** Fires after a successful create, before the navigation to /project. */
		let name = "Untitled Project";
		let parentPath = null;
		let busy = false;
		let error = "";
		async function pickFolder() {
			error = "";
			const pick = await pickFolderViaDesktop({ title: "Pick the folder that will contain the new project" });
			if (!pick.ok) {
				if ("cancelled" in pick) return;
				error = pick.error ?? "Could not open picker";
				return;
			}
			parentPath = pick.path;
		}
		function cancel() {
			open = false;
			parentPath = null;
			error = "";
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->New project`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <form class="flex flex-col gap-4"><label class="flex flex-col gap-1.5 text-xs"><span class="text-muted-foreground uppercase tracking-wider">Name</span> <input type="text"${attr("value", name)} placeholder="Untitled Project" class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"/></label> <div class="flex flex-col gap-1.5 text-xs"><span class="text-muted-foreground uppercase tracking-wider">Folder</span> <div class="flex items-center gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								size: "sm",
								onclick: () => void pickFolder(),
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html(parentPath ? "Change…" : "Choose folder…")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (parentPath) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]"${attr("title", parentPath)}>${escape_html(parentPath)}</span>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (parentPath) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<span class="text-muted-foreground text-[11px]">A subfolder for the project will be created here.</span>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (error) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-destructive text-xs" role="status">${escape_html(error)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="flex justify-end gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								onclick: cancel,
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Cancel`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Button($$renderer, {
								class: "",
								type: "submit",
								disabled: (name.trim(), !parentPath),
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html("Create")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----></div></form>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/client/cloudSync.ts
/**
* Client-side wrapper for the cloud collab REST surface
* (`/api/cloud/projects/**`). Translates between local types
* (`ProjectFile`, `SongMap`) and the wire shape, strips local-only
* SongMap fields via `toCollabSongMap` on the way out, and stamps
* `ProjectFile.cloud.lastSyncedRevision` on success.
*
* Naming convention: every public function reads or writes through the
* SvelteKit `/api/cloud/**` routes — no direct PostgREST. The session
* cookie is on the same origin so plain `fetch` carries auth.
*/
var BASE = "/api/cloud";
/** Returns the projects the current user is a member of. */
async function listCloudProjects() {
	const res = await fetch(`${BASE}/projects`, { cache: "no-store" });
	if (!res.ok) return [];
	const data = await res.json().catch(() => null);
	return data?.ok ? data.projects ?? [] : [];
}
/** Pending invites owned by the current user's project (owner-only). */
async function listPendingInvites(cloudProjectId) {
	const res = await fetch(`${BASE}/projects/${cloudProjectId}/pending-invites`, { cache: "no-store" });
	if (!res.ok) return [];
	const data = await res.json().catch(() => null);
	return data?.ok ? data.invites ?? [] : [];
}
/** Pending invites visible to the signed-in user (matched by email). */
async function listMyPendingInvites() {
	const res = await fetch(`${BASE}/invites/mine`, { cache: "no-store" });
	if (!res.ok) return [];
	const data = await res.json().catch(() => null);
	return data?.ok ? data.invites ?? [] : [];
}
/**
* Accept one pending invite — promotes it to a `cloud_project_members`
* row server-side. Caller still has to call `joinCloudProject()` to
* materialize the project locally.
*/
async function acceptPendingInvite(cloudProjectId) {
	const res = await fetch(`${BASE}/invites/mine`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ projectId: cloudProjectId }),
		cache: "no-store"
	});
	if (!res.ok) return {
		ok: false,
		error: await res.text().catch(() => "") || `HTTP ${res.status}`
	};
	return { ok: true };
}
async function getCloudProjectManifest(cloudProjectId) {
	const res = await fetch(`${BASE}/projects/${cloudProjectId}`, { cache: "no-store" });
	if (!res.ok) return null;
	const data = await res.json().catch(() => null);
	return data?.ok ? {
		project: data.project,
		members: data.members
	} : null;
}
async function fetchCloudSongs(cloudProjectId, sinceRevision) {
	const u = new URL(`${BASE}/projects/${cloudProjectId}/songs`, window.location.origin);
	if (typeof sinceRevision === "number" && sinceRevision > 0) u.searchParams.set("since", String(sinceRevision));
	const res = await fetch(u.pathname + u.search, { cache: "no-store" });
	if (!res.ok) return [];
	const data = await res.json().catch(() => null);
	return data?.ok ? data.songs ?? [] : [];
}
/**
* Turn the currently-open local project into a cloud project. Strips
* local-only SongMap fields, posts the create payload, and stamps the
* `cloud` block onto the project manifest.
*
* Caller must ensure every song's `.smap` is on disk first (autosave's
* standard guarantee — the manifest only ever references songs that
* actually exist).
*/
async function createCloudProject() {
	const snap = get$1(project);
	const proj = snap.data;
	const osPath = snap.osPath;
	if (!proj || !osPath) return {
		ok: false,
		error: "No project open."
	};
	if (proj.cloud) return {
		ok: false,
		error: "Project is already linked to the cloud."
	};
	const songs = [];
	for (let i = 0; i < proj.songs.length; i++) {
		const entry = proj.songs[i];
		const r = await readProjectSong(osPath, entry.folder);
		if (!r.ok) return {
			ok: false,
			error: `Read failed for ${entry.folder}: ${r.error}`
		};
		const sm = (await decodeSmapFile(new Blob([r.bytes], { type: "application/octet-stream" }))).project.songMap;
		const collab = toCollabSongMap(sm);
		const expected = expectedAudioFromSongMap(sm);
		songs.push({
			id: entry.id,
			songMap: collab,
			expectedAudio: expected,
			hidden: !!entry.hidden,
			sortOrder: i
		});
	}
	const body = {
		projectId: proj.id,
		name: proj.name,
		songs
	};
	const res = await fetch(`${BASE}/projects`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	if (!res.ok) return {
		ok: false,
		error: await res.text().catch(() => "") || `HTTP ${res.status}`
	};
	const data = await res.json();
	const cloud = {
		projectId: data.cloudProjectId,
		lastSyncedRevision: data.revision,
		lastPushedAt: (/* @__PURE__ */ new Date()).toISOString(),
		lastPulledAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	const next = {
		...proj,
		cloud,
		songs: proj.songs.map((s) => ({
			...s,
			cloudSongId: s.id,
			lastSyncedRevision: data.revision
		}))
	};
	setProjectData(next);
	await persistManifest(osPath, next);
	return {
		ok: true,
		cloudProjectId: data.cloudProjectId,
		revision: data.revision
	};
}
/**
* Pull all changes since `cloud.lastSyncedRevision`, merge them into
* each song's `.smap` on disk, and bump the sync watermark.
*
* For now this is a straight overwrite (Phase 4 model). Phase 8 will
* route same-song conflicts through `collabMerge.ts` before writing.
*/
async function pullCloudChanges() {
	const snap = get$1(project);
	const proj = snap.data;
	const osPath = snap.osPath;
	if (!proj || !osPath || !proj.cloud) return {
		ok: false,
		error: "No cloud project."
	};
	const cloudProjectId = proj.cloud.projectId;
	const manifest = await getCloudProjectManifest(cloudProjectId);
	if (!manifest) return {
		ok: false,
		error: "Could not fetch cloud manifest."
	};
	const sinceRev = proj.cloud.lastSyncedRevision;
	const songs = await fetchCloudSongs(cloudProjectId, sinceRev);
	for (const cloudSong of songs) await applyCloudSongIntoLocal(osPath, proj, cloudSong);
	const nextManifest = {
		...proj,
		name: manifest.project.name,
		cloud: {
			...proj.cloud,
			lastSyncedRevision: manifest.project.revision,
			lastPulledAt: (/* @__PURE__ */ new Date()).toISOString()
		}
	};
	setProjectData(nextManifest);
	await persistManifest(osPath, nextManifest);
	return {
		ok: true,
		pulledSongs: songs.length,
		revision: manifest.project.revision
	};
}
/**
* Join a cloud project on this machine. Creates a fresh local project
* folder under `parentPath`, materializes every cloud song as a local
* `.smap` (no audio bytes — those land via Phase 6's audio pack or a
* relink), and stamps the local↔cloud link onto the new manifest.
*
* Mostly intended for first-time joins on a new machine. If the user
* already has the project locally somewhere else, this creates a
* second copy — the linked cloud row is the same, so edits between
* the two copies sync; the redundancy is benign but worth flagging
* in the UI.
*/
async function joinCloudProject(cloudProjectId, parentPath) {
	const manifest = await getCloudProjectManifest(cloudProjectId);
	if (!manifest) return {
		ok: false,
		error: "Could not fetch cloud project manifest."
	};
	const cloudSongs = await fetchCloudSongs(cloudProjectId);
	const created = await createProject(parentPath, manifest.project.name);
	if (!created.ok) return {
		ok: false,
		error: created.error
	};
	const projectPath = created.projectPath;
	const localSongs = [];
	const meta = {};
	for (const cs of cloudSongs) {
		const sm = cs.song_map;
		const withExpected = cs.expected_audio ? {
			...sm,
			expectedAudio: cs.expected_audio
		} : sm;
		const smapBlob = await encodeSmapFile({ project: {
			projectFormatVersion: 1,
			songMap: withExpected
		} });
		const smapBytes = new Uint8Array(await smapBlob.arrayBuffer());
		const folderRel = `${PROJECT_SONGS_DIR}/${songFolderName(sm.metadata?.title ?? "song", cs.id)}`;
		const songCreate = await createProjectSong(projectPath, folderRel, smapBytes);
		if (!songCreate.ok) {
			console.warn(`[cloudSync] join: createProjectSong failed for ${cs.id}: ${songCreate.error}`);
			continue;
		}
		const entry = {
			id: cs.id,
			folder: folderRel,
			cloudSongId: cs.id,
			lastSyncedRevision: cs.revision
		};
		if (cs.hidden) entry.hidden = true;
		localSongs.push(entry);
		meta[folderRel] = metadataLiteFromSongMap(withExpected);
	}
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const finalManifest = {
		formatVersion: 1,
		id: cloudProjectId,
		name: manifest.project.name,
		createdAt: created.manifest.createdAt,
		updatedAt: now,
		songs: localSongs,
		cloud: {
			projectId: cloudProjectId,
			lastSyncedRevision: manifest.project.revision,
			lastPushedAt: now,
			lastPulledAt: now
		}
	};
	const write = await writeProjectManifest(projectPath, finalManifest);
	if (!write.ok) return {
		ok: false,
		error: `Manifest write failed after join: ${write.error}`
	};
	setActiveProject(projectPath, finalManifest, meta);
	writeLastProjectPath(projectPath);
	recordRecentProjectPath(projectPath);
	return {
		ok: true,
		projectPath
	};
}
/**
* Disable cloud collab for the current project.
*
*  - `deleteRemote: true`  → owner-only. DELETE on the cloud row; cascades
*                            to songs/members/revisions. Then clears the
*                            local `cloud` block.
*  - `deleteRemote: false` → just clears the local `cloud` block (project
*                            stays in the cloud for other members). Use
*                            this to "leave" a project you don't own.
*
* Audio + .smap files on disk are untouched either way.
*/
async function disableCloudProject(options = { deleteRemote: false }) {
	const snap = get$1(project);
	const proj = snap.data;
	const osPath = snap.osPath;
	if (!proj || !osPath) return {
		ok: false,
		error: "No project open."
	};
	if (!proj.cloud) return {
		ok: false,
		error: "Project is not linked."
	};
	if (options.deleteRemote) {
		const res = await fetch(`${BASE}/projects/${proj.cloud.projectId}`, { method: "DELETE" });
		if (!res.ok) return {
			ok: false,
			error: await res.text().catch(() => "") || `HTTP ${res.status}`
		};
	}
	const next = {
		...proj,
		songs: proj.songs.map((s) => {
			const { cloudSongId: _c, lastSyncedRevision: _r, ...rest } = s;
			return rest;
		})
	};
	delete next.cloud;
	setProjectData(next);
	await persistManifest(osPath, next);
	return { ok: true };
}
/**
* Push one local song's current `.smap` to the cloud. Used by the
* autosave's debounced cloud-push subscription — see
* `projectAutosave.ts`. On 409 conflict the caller is expected to
* trigger a `pullCloudChanges` and let the merge layer (Phase 8) sort
* it out; for Phase 4 we just surface the conflict.
*/
async function pushCloudSong(cloudProjectId, cloudSongId, songMap, sortOrder, hidden, clientBaseRevision) {
	const body = {
		songMap: toCollabSongMap(songMap),
		expectedAudio: expectedAudioFromSongMap(songMap),
		sortOrder,
		hidden,
		clientBaseRevision
	};
	const res = await fetch(`${BASE}/projects/${cloudProjectId}/songs/${cloudSongId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	if (res.ok) return {
		ok: true,
		revision: (await res.json()).revision
	};
	if (res.status === 409) return {
		ok: false,
		conflict: true,
		remote: (await res.json().catch(() => null))?.remote ?? null
	};
	return {
		ok: false,
		conflict: false,
		error: await res.text().catch(() => "") || `HTTP ${res.status}`
	};
}
function expectedAudioFromSongMap(sm) {
	const a = sm.audio;
	if (!a) return null;
	const out = { fileName: a.fileName };
	if (a.mimeType) out.mimeType = a.mimeType;
	if (a.durationSec !== void 0) out.durationSec = a.durationSec;
	if (a.sampleRate !== void 0) out.sampleRate = a.sampleRate;
	if (a.channels !== void 0) out.channels = a.channels;
	if (a.fileSize !== void 0) out.fileSize = a.fileSize;
	if (a.sha256) out.sha256 = a.sha256;
	if (a.originalSha256) out.originalSha256 = a.originalSha256;
	return out;
}
async function persistManifest(osPath, next) {
	const r = await writeProjectManifest(osPath, next);
	if (!r.ok) console.warn("[cloudSync] persistManifest failed:", r.error);
}
/**
* Apply one cloud song into the local project, by:
*   1. Finding the matching local song by id (== cloud_song.id).
*   2. Reading its current .smap, merging the cloud song_map fields
*      back in via the strip rule (so local-only fields survive).
*   3. Writing the updated .smap.
* Songs that don't exist locally yet are skipped here — Phase 4 MVP
* doesn't auto-create a new song folder mid-sync (that's
* `joinCloudProject` territory which lands later).
*/
async function applyCloudSongIntoLocal(osPath, proj, cloudSong) {
	const entry = proj.songs.find((s) => s.id === cloudSong.id);
	if (!entry) {
		patchMetadataForFolder(`songs/${cloudSong.id.slice(0, 8)}`, { title: cloudSong.song_map.metadata?.title ?? cloudSong.id.slice(0, 8) });
		return;
	}
	const r = await readProjectSong(osPath, entry.folder);
	if (!r.ok) {
		console.warn("[cloudSync] readProjectSong failed during pull:", r.error);
		return;
	}
	const local = (await decodeSmapFile(new Blob([r.bytes], { type: "application/octet-stream" }))).project.songMap;
	const { mergeLocalIntoCollab } = await import("./collab.js");
	const merged = mergeLocalIntoCollab(local, cloudSong.song_map);
	merged.expectedAudio = cloudSong.expected_audio ?? void 0;
	const { encodeSmapFile } = await import("./smapFile2.js");
	const blobOut = await encodeSmapFile({ project: {
		projectFormatVersion: 1,
		songMap: merged
	} });
	const { writeProjectSong } = await import("./desktopProjectFs.js");
	await writeProjectSong(osPath, entry.folder, new Uint8Array(await blobOut.arrayBuffer()));
}
//#endregion
//#region src/lib/stores/cloudConflict.ts
var cloudConflict = writable(null);
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/folder-open.svelte
function Folder_open($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "folder-open" },
			props,
			{
				iconNode: [["path", { "d": "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
export { Dropdown_menu_content as _, disableCloudProject as a, listCloudProjects as c, pullCloudChanges as d, pushCloudSong as f, Dropdown_menu_item as g, Dropdown_menu_separator as h, createCloudProject as i, listMyPendingInvites as l, Dropdown_menu_trigger as m, cloudConflict as n, getCloudProjectManifest as o, NewProjectDialog as p, acceptPendingInvite as r, joinCloudProject as s, Folder_open as t, listPendingInvites as u, Dropdown_menu as v };
