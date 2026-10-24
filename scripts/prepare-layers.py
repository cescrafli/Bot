import cv2
import numpy as np
from PIL import Image

def process_avatar():
    img_path = 'apps/web/public/celyn_avatar.png'
    im_bgr = cv2.imread(img_path)
    h, w = im_bgr.shape[:2]
    
    # 1. Background Masking via FloodFill from borders
    bg_color = np.array([174, 181, 195], dtype=np.uint8) # BGR
    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    
    # FloodFill from top-left, top-right, bottom-left, bottom-right
    im_flood = im_bgr.copy()
    diff = (14, 14, 14)
    for pt in [(5, 5), (w - 5, 5), (5, h - 5), (w - 5, h - 5), (w//2, 5)]:
        cv2.floodFill(im_flood, mask, pt, (0, 0, 0), diff, diff, flags=4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY)
    
    # mask[1:h+1, 1:w+1] contains 255 for background
    bg_mask = mask[1:h+1, 1:w+1]
    
    # Erode/dilate slightly for smooth antialiased edges
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    alpha = 255 - bg_mask
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    
    # Create cutout with alpha
    im_rgba = cv2.cvtColor(im_bgr, cv2.COLOR_BGR2BGRA)
    im_rgba[:, :, 3] = alpha
    
    cv2.imwrite('apps/web/public/celyn_cutout.png', im_rgba)
    print("Created celyn_cutout.png")
    
    # 2. Extract Front Left Hair Strand
    # Left hair strand in image coordinates: x in [230, 360], y in [240, 680]
    hair_left = np.zeros_like(im_rgba)
    mask_hl = np.zeros((h, w), dtype=np.uint8)
    poly_hl = np.array([[245, 230], [350, 240], [365, 520], [330, 680], [250, 680], [220, 520]], dtype=np.int32)
    cv2.fillPoly(mask_hl, [poly_hl], 255)
    mask_hl = cv2.GaussianBlur(mask_hl, (15, 15), 0)
    
    hair_left[:, :, :3] = im_rgba[:, :, :3]
    hair_left[:, :, 3] = np.minimum(im_rgba[:, :, 3], mask_hl)
    cv2.imwrite('apps/web/public/celyn_hair_left.png', hair_left)
    print("Created celyn_hair_left.png")
    
    # 3. Extract Front Right Hair Strand
    # Right hair strand in image coordinates: x in [410, 540], y in [240, 680]
    hair_right = np.zeros_like(im_rgba)
    mask_hr = np.zeros((h, w), dtype=np.uint8)
    poly_hr = np.array([[420, 240], [525, 230], [550, 520], [520, 680], [440, 680], [405, 520]], dtype=np.int32)
    cv2.fillPoly(mask_hr, [poly_hr], 255)
    mask_hr = cv2.GaussianBlur(mask_hr, (15, 15), 0)
    
    hair_right[:, :, :3] = im_rgba[:, :, :3]
    hair_right[:, :, 3] = np.minimum(im_rgba[:, :, 3], mask_hr)
    cv2.imwrite('apps/web/public/celyn_hair_right.png', hair_right)
    print("Created celyn_hair_right.png")
    
    # 4. Extract Left Arm & Hand (Character's right arm, user's left)
    # x in [100, 230], y in [440, 1024]
    arm_left = np.zeros_like(im_rgba)
    mask_al = np.zeros((h, w), dtype=np.uint8)
    poly_al = np.array([[160, 440], [230, 470], [220, 750], [210, 1000], [110, 1000], [130, 750]], dtype=np.int32)
    cv2.fillPoly(mask_al, [poly_al], 255)
    mask_al = cv2.GaussianBlur(mask_al, (11, 11), 0)
    
    arm_left[:, :, :3] = im_rgba[:, :, :3]
    arm_left[:, :, 3] = np.minimum(im_rgba[:, :, 3], mask_al)
    cv2.imwrite('apps/web/public/celyn_arm_left.png', arm_left)
    print("Created celyn_arm_left.png")
    
    # 5. Extract Right Arm & Hand (Character's left arm, user's right)
    # x in [540, 670], y in [440, 1024]
    arm_right = np.zeros_like(im_rgba)
    mask_ar = np.zeros((h, w), dtype=np.uint8)
    poly_ar = np.array([[540, 470], [610, 440], [640, 750], [660, 1000], [560, 1000], [550, 750]], dtype=np.int32)
    cv2.fillPoly(mask_ar, [poly_ar], 255)
    mask_ar = cv2.GaussianBlur(mask_ar, (11, 11), 0)
    
    arm_right[:, :, :3] = im_rgba[:, :, :3]
    arm_right[:, :, 3] = np.minimum(im_rgba[:, :, 3], mask_ar)
    cv2.imwrite('apps/web/public/celyn_arm_right.png', arm_right)
    print("Created celyn_arm_right.png")

process_avatar()
