// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

impl Value {
    pub fn get(&self, key: &str) -> &Value {
        if let Self::Object(o) = self {
            o.get(key).unwrap_or(&Value::Null)
        } else {
            &Value::Null
        }
    }
    pub fn array(&self) -> &[Value] {
        if let Self::Array(a) = self {
            a
        } else {
            &[]
        }
    }
    pub fn str(&self) -> &str {
        if let Self::String(s) = self {
            s
        } else {
            ""
        }
    }
    pub fn num(&self, default: f64) -> f64 {
        if let Self::Number(n) = self {
            *n
        } else {
            default
        }
    }
    pub fn object(items: Vec<(&str, Value)>) -> Value {
        Value::Object(items.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }
    pub fn stringify(&self) -> String {
        match self {
            Self::Null => "null".into(),
            Self::Bool(b) => b.to_string(),
            Self::Number(n) => {
                if n.is_finite() {
                    n.to_string()
                } else {
                    "null".into()
                }
            }
            Self::String(s) => {
                let mut out = String::from("\"");
                for c in s.chars() {
                    match c {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\t' => out.push_str("\\t"),
                        c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
                        c => out.push(c),
                    }
                }
                out.push('"');
                out
            }
            Self::Array(a) => format!(
                "[{}]",
                a.iter()
                    .map(|v| v.stringify())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::Object(o) => format!(
                "{{{}}}",
                o.iter()
                    .map(|(k, v)| format!(
                        "{}:{}",
                        Self::String(k.clone()).stringify(),
                        v.stringify()
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        }
    }
}
impl From<f64> for Value {
    fn from(x: f64) -> Self {
        Self::Number(x)
    }
}
impl From<usize> for Value {
    fn from(x: usize) -> Self {
        Self::Number(x as f64)
    }
}
impl From<String> for Value {
    fn from(x: String) -> Self {
        Self::String(x)
    }
}
impl From<&str> for Value {
    fn from(x: &str) -> Self {
        Self::String(x.into())
    }
}

pub fn parse(input: &str) -> Result<Value, String> {
    struct Parser<'a> {
        b: &'a [u8],
        i: usize,
    }
    impl<'a> Parser<'a> {
        fn ws(&mut self) {
            while self.i < self.b.len() && self.b[self.i].is_ascii_whitespace() {
                self.i += 1
            }
        }
        fn expect(&mut self, c: u8) -> Result<(), String> {
            self.ws();
            if self.b.get(self.i) == Some(&c) {
                self.i += 1;
                Ok(())
            } else {
                Err(format!("Expected {} at {}", c as char, self.i))
            }
        }
        fn hex(&mut self) -> Result<u32, String> {
            let mut n = 0;
            for _ in 0..4 {
                let c = *self.b.get(self.i).ok_or("Incomplete unicode escape")?;
                self.i += 1;
                n = n * 16 + (c as char).to_digit(16).ok_or("Invalid unicode escape")?
            }
            Ok(n)
        }
        fn string(&mut self) -> Result<String, String> {
            self.expect(b'"')?;
            let mut out = String::new();
            let mut start = self.i;
            loop {
                let c = *self.b.get(self.i).ok_or("Unterminated string")?;
                if c == b'"' {
                    out.push_str(
                        std::str::from_utf8(&self.b[start..self.i]).map_err(|_| "Invalid UTF-8")?,
                    );
                    self.i += 1;
                    return Ok(out);
                }
                if c == b'\\' {
                    out.push_str(
                        std::str::from_utf8(&self.b[start..self.i]).map_err(|_| "Invalid UTF-8")?,
                    );
                    self.i += 1;
                    let e = *self.b.get(self.i).ok_or("Missing escape")?;
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let mut cp = self.hex()?;
                            if (0xd800..=0xdbff).contains(&cp) {
                                if self.b.get(self.i..self.i + 2) != Some(b"\\u") {
                                    return Err("Missing low surrogate".into());
                                }
                                self.i += 2;
                                let low = self.hex()?;
                                if !(0xdc00..=0xdfff).contains(&low) {
                                    return Err("Invalid low surrogate".into());
                                }
                                cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00)
                            }
                            out.push(char::from_u32(cp).ok_or("Invalid unicode scalar")?)
                        }
                        _ => return Err("Invalid escape".into()),
                    }
                    start = self.i;
                } else {
                    if c < 0x20 {
                        return Err("Control character in string".into());
                    }
                    self.i += 1
                }
            }
        }
        fn value(&mut self, depth: usize) -> Result<Value, String> {
            if depth > 96 {
                return Err("JSON nesting limit exceeded".into());
            }
            self.ws();
            let c = *self.b.get(self.i).ok_or("Missing value")?;
            match c {
                b'"' => Ok(Value::String(self.string()?)),
                b'[' => {
                    self.i += 1;
                    let mut a = vec![];
                    self.ws();
                    if self.b.get(self.i) == Some(&b']') {
                        self.i += 1;
                        return Ok(Value::Array(a));
                    }
                    loop {
                        a.push(self.value(depth + 1)?);
                        self.ws();
                        if self.b.get(self.i) == Some(&b']') {
                            self.i += 1;
                            break;
                        }
                        self.expect(b',')?;
                    }
                    Ok(Value::Array(a))
                }
                b'{' => {
                    self.i += 1;
                    let mut o = BTreeMap::new();
                    self.ws();
                    if self.b.get(self.i) == Some(&b'}') {
                        self.i += 1;
                        return Ok(Value::Object(o));
                    }
                    loop {
                        let k = self.string()?;
                        self.expect(b':')?;
                        let v = self.value(depth + 1)?;
                        if o.insert(k, v).is_some() {
                            return Err("Duplicate object key".into());
                        }
                        self.ws();
                        if self.b.get(self.i) == Some(&b'}') {
                            self.i += 1;
                            break;
                        }
                        self.expect(b',')?
                    }
                    Ok(Value::Object(o))
                }
                b't' | b'f' | b'n' => {
                    for (s, v) in [
                        ("true", Value::Bool(true)),
                        ("false", Value::Bool(false)),
                        ("null", Value::Null),
                    ] {
                        if self.b[self.i..].starts_with(s.as_bytes()) {
                            self.i += s.len();
                            return Ok(v);
                        }
                    }
                    Err("Invalid literal".into())
                }
                b'-' | b'0'..=b'9' => {
                    let start = self.i;
                    if c == b'-' {
                        self.i += 1
                    }
                    let first = *self.b.get(self.i).ok_or("Invalid number")?;
                    if first == b'0' {
                        self.i += 1
                    } else if first.is_ascii_digit() {
                        while self.b.get(self.i).map_or(false, |x| x.is_ascii_digit()) {
                            self.i += 1
                        }
                    } else {
                        return Err("Invalid number".into());
                    }
                    if self.b.get(self.i) == Some(&b'.') {
                        self.i += 1;
                        let n = self.i;
                        while self.b.get(self.i).map_or(false, |x| x.is_ascii_digit()) {
                            self.i += 1
                        }
                        if n == self.i {
                            return Err("Invalid fraction".into());
                        }
                    }
                    if self
                        .b
                        .get(self.i)
                        .map_or(false, |x| *x == b'e' || *x == b'E')
                    {
                        self.i += 1;
                        if self
                            .b
                            .get(self.i)
                            .map_or(false, |x| *x == b'+' || *x == b'-')
                        {
                            self.i += 1
                        }
                        let n = self.i;
                        while self.b.get(self.i).map_or(false, |x| x.is_ascii_digit()) {
                            self.i += 1
                        }
                        if n == self.i {
                            return Err("Invalid exponent".into());
                        }
                    }
                    let n = std::str::from_utf8(&self.b[start..self.i])
                        .map_err(|_| "Invalid number")?
                        .parse::<f64>()
                        .map_err(|_| "Invalid number")?;
                    if !n.is_finite() {
                        return Err("Non-finite number".into());
                    }
                    Ok(Value::Number(n))
                }
                _ => Err(format!("Unexpected token at {}", self.i)),
            }
        }
    }
    let mut p = Parser {
        b: input.as_bytes(),
        i: 0,
    };
    let v = p.value(0)?;
    p.ws();
    if p.i != p.b.len() {
        return Err("Trailing JSON content".into());
    }
    Ok(v)
}
