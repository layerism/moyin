Create one horizontal animation strip for Codex pet `shuibao`, state `running-right`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 8 full-body frames in one left-to-right row on flat pure cyan #00FFFF. Treat the row as 8 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: 保留参考照片中长直黑发、温柔微笑和亲和面容；设计为完整全身的迷你贴纸风人物桌宠，穿简洁深灰家居短袖，配小型睡帽与被角披肩作为稳定身份元素；气质慵懒爱睡、节俭朴素、通情达理、体贴支持从事科研与编程的丈夫。避免文字、品牌、夸张奢华、讽刺或负面刻板印象。. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `sticker`: Polished sticker mascot with bold clean shapes, crisp outline, flat colors, and minimal highlight detail. User style notes: 精致温暖的非像素 Q 版贴纸风，头身比约 1:1.6，清晰大轮廓，柔和暖色皮肤、黑发、深灰衣服、低饱和米粉色点缀，适合 192x208 小尺寸显示。.
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Dragging-right loop: show directional movement to the right through body and limb poses only.

State requirements:
- Show directional drag movement to the right through body, limb, and prop movement only.
- The row must unmistakably face and travel right.
- The movement cadence must alternate visibly across the 8 frames instead of repeating one nearly static stride.
- Do not draw speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
