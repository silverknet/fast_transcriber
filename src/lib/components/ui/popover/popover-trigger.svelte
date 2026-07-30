<script>
	import { Popover as PopoverPrimitive } from "bits-ui";

	let { ref = $bindable(null), ...restProps } = $props();
</script>

<PopoverPrimitive.Trigger bind:ref data-slot="popover-trigger" {...restProps} />
