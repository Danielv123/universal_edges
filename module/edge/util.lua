local vectorutil = require("modules/universal_edges/vectorutil")

local function edge_get_local_target(edge)
	if global.universal_edges.config.instance_id == edge.source.instanceId then
		return edge.source
	elseif global.universal_edges.config.instance_id == edge.target.instanceId then
		return edge.target
	end
end
local function world_to_edge_pos(pos, edge)
	local local_edge_target = edge_get_local_target(edge)
	return vectorutil.vec2_rot(vectorutil.vec2_sub(pos, local_edge_target.origin), -local_edge_target.direction % 8)
end
local function edge_pos_to_world(edge_pos, edge)
	local local_edge_target = edge_get_local_target(edge)
	return vectorutil.vec2_add(vectorutil.vec2_rot(edge_pos, local_edge_target.direction), local_edge_target.origin)
end
local function edge_pos_to_offset(edge_pos, edge)
	local local_edge_target = edge_get_local_target(edge)
	local offset = edge_pos[1]
	if local_edge_target.direction >= 4 then
		offset = edge.length - offset
	end
	return offset
end
local function offset_to_edge_x(offset, edge)
	local local_edge_target = edge_get_local_target(edge)
	local edge_x = offset
	if local_edge_target.direction >= 4 then
		edge_x = edge.length - edge_x
	end
	return edge_x
end

return {
	edge_get_local_target = edge_get_local_target,
	world_to_edge_pos = world_to_edge_pos,
	edge_pos_to_world = edge_pos_to_world,
	edge_pos_to_offset = edge_pos_to_offset,
	offset_to_edge_x = offset_to_edge_x,
}
