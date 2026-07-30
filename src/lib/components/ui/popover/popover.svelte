<script>
	import { Popover as PopoverPrimitive } from "bits-ui";

	let { ...restProps } = $props();
</script>

<PopoverPrimitive.Root data-slot="popover" {...restProps} />
