// SPDX-License-Identifier: Apache-2.0
mod context;
mod corridors;
mod geometry;
mod json;
mod lanes;
mod layout;
mod osm;
mod osm_route;
mod stations;
use json::Value;
#[cfg(feature = "profiling")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn oti_progress(stage: u32);
}
pub fn mark(stage: u32) {
    #[cfg(feature = "profiling")]
    unsafe {
        oti_progress(stage)
    }
    #[cfg(not(feature = "profiling"))]
    let _ = stage;
}

#[no_mangle]
pub extern "C" fn oti_alloc(len: usize) -> *mut u8 {
    if len > 32 * 1024 * 1024 {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn oti_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)))
    }
}

#[no_mangle]
pub unsafe extern "C" fn oti_run(ptr: *const u8, len: usize) -> *mut u8 {
    let result = if len > 16 * 1024 * 1024 {
        Err("Input exceeds 16 MiB".into())
    } else {
        std::str::from_utf8(std::slice::from_raw_parts(ptr, len))
            .map_err(|_| "Invalid UTF-8".into())
            .and_then(json::parse)
            .and_then(|v| {
                if v.get("operation").str() == "openstreetmap-route" {
                    osm_route::build(&v)
                } else if v.get("operation").str() == "openstreetmap" {
                    osm::import(v.get("data"))
                } else if v.get("operation").str() == "topology" {
                    layout::topology(&v)
                } else {
                    layout::layout(&v)
                }
            })
    };
    let value = match result {
        Ok(v) => v,
        Err(e) => Value::object(vec![("error", e.into())]),
    };
    let payload = value.stringify().into_bytes();
    let mut out = Vec::with_capacity(payload.len() + 4);
    out.extend((payload.len() as u32).to_le_bytes());
    out.extend(payload);
    Box::into_raw(out.into_boxed_slice()) as *mut u8
}
