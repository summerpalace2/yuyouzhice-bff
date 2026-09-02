/**
 * 地理计算与距离格式化工具函数
 */

export function calculateDistanceMeters(coord1, coord2) {
  if (!coord1 || !coord2 || coord1.length < 2 || coord2.length < 2) return null;
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371000;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || isNaN(meters)) return '未知';
  if (meters < 1000) return `${meters}米`;
  return `${(meters / 1000).toFixed(1)}公里`;
}
