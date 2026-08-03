<script>
	import { cn } from "$lib/utils.js";
	import PopoverPortal from "./popover-portal.svelte";
	import { Popover as PopoverPrimitive } from "bits-ui";
	let {
		ref = $bindable(null),
		sideOffset = 6,
		align = "center",
		portalProps = {},
		class: className,
		...restProps
	} = $props();
</script>

<PopoverPortal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		{align}
		class={cn(
			"brutalist-shadow-sm data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 bg-popover text-popover-foreground rounded-[var(--radius)] border-2 border-foreground p-3 duration-100 z-50 outline-none",
			className
		)}
		{...restProps}
	/>
</PopoverPortal>
