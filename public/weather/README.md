# Weather effects artwork

Generated with the built-in imagegen tool on 2026-09-07. Style reference for
all three: [the day clearing](../scenes/exterior-day-v1.webp). Original generated
alpha is retained for the cumulus and flame. Converted to WebP with Sharp:
900 × 300 at quality 84, 800 × 400 at quality 84, and 128 × 192 at quality 86.
About 75 KB combined. No source painting or generated horizon was changed.

The overcast texture is used once, oversized, rather than trusting generated
edge matching to make a seamless repeat. CSS filters set ambient cloud color.

## Generation prompts

### [cumulus-v1.webp](cumulus-v1.webp)

Use case: illustration-story. Generate a production transparent cloud sprite asset for the weather widget whose painted woodland artwork is the reference. Reference is STYLE ONLY; do not reproduce forest or landscape. One elongated bank of loosely clustered natural cumulus clouds, entirely isolated on genuine transparent background, generous transparent padding at all four edges. Wide 3:1 composition. Painterly gouache, soft scumbled brushwork, subtly grainy pigments, warm ivory illuminated tops, muted sage-grey and slate blue shaded undersides; irregular wisps dissolving into transparency, real voluminous lobes with delicate internal tonal brushwork, no hard outlines. The bank should have several uneven heights with open gaps and small detached wisps, never a symmetrical row of circles. No sun, trees, ground, rain, text, checkerboard or background. This will be displayed ~300px wide in a storybook forest scene; elegant restrained texture readable at small scale.

### [overcast-v1.webp](overcast-v1.webp)

Use case illustration-story. Create a seamless horizontally tileable PAINTED OVERCAST CLOUD TEXTURE for the sky in the reference woodland scene. Style reference only. 3:1 wide composition filled edge to edge with soft irregular low stratus storm clouds. Full opaque rectangular texture, NO transparency. Muted sage grey, slate blue-grey undersides and pale warm-grey upper highlights, scumbled gouache brush texture like the reference. Soft rolling turbulent layers and small ragged wisps, atmospheric depth and subtle tonal gradations, no sharp outlines, no blue sky gaps, no dark dramatic thunderstorm, no horizon, landscape, sun, lightning, rain, text or objects. Left and right edges should match for seamless repeat. The lower third softens into a uniform muted grey-green haze. This is a gentle storybook rainy-day cloud ceiling, not photorealistic.

### [flame-v1.webp](flame-v1.webp)

Use case illustration-story. Transparent VFX sprite for a tiny campfire in the supplied painterly woodland scene. Reference is style only. Paint ONLY a small tuft of dancing campfire FLAMES, isolated on true transparent background, generous padding. Three asymmetric interwoven slender tongues of flame curling upward, warm burnt amber outer edges softly dissolving into transparency, orange and golden ochre midtones, pale butter-yellow core at the base. Strong internal painterly brush texture, luminous but restrained, soft gouache brushwork matching the forest. Natural campfire, no symmetrical icon shape, no cartoon outline, no photorealism, no neon, no smoke, NO LOGS, NO STONES, NO GROUND, no background, no rectangular glow. Flame cluster roughly twice as tall as wide, centered. Will be used at 25 pixels tall over separately drawn logs. A single flame cluster, no sprite sheet, no text.
