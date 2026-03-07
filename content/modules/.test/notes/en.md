# Markdown Comprehensive Simple Test Case

## 1. Headings

# H1 Heading

## H2 Heading

### H3 Heading

#### H4 Heading

##### H5 Heading

###### H6 Heading

## 2. Text Styles

**Bold**

_Italic_

**_Bold Italic_**

~~Strikethrough~~

==Highlight== (some platforms)

H~2~O　　X^2^ + Y^3^

Text with <sup>superscript</sup> and <sub>subscript</sub>

## 3. Lists

### Unordered

- Item 1
- Item 2
  - Sub A
  - Sub B
- Item 3

### Ordered

1. First
2. Second
   1. Sub 2.1
   2. Sub 2.2
3. Third

### Task List

- [x] Done task
- [ ] Pending task
- [x] ~~Canceled task~~

## 4. Blockquote

> Life is like a box of chocolates. You never know what you're gonna get.
>
> > Nested quote
> >
> > > Deep nested quote

## 5. Code

Inline: Use `console.log("Hi")`

Indented:

    function add(a, b) {
      return a + b;
    }

Fenced:

```javascript
function greet(name) {
  return `Hello, ${name}!`
}
```

```python
def fib(n):
    return n if n <= 1 else fib(n-1) + fib(n-2)
```

Plain text block:

```
Plain text content
log lines
config lines
```

## 6. Horizontal Rules

---

## 7. Links & Images

[Example](https://example.com)

[With title](https://example.com 'Tooltip')

Auto: https://github.com

Image: ![Markdown](https://markdown-here.com/img/icon256.png 'Markdown Here')

Reference: ![Kitten][kitten]

[kitten]: https://placekitten.com/320/240

## 8. Table

| Fruit  | Price |    Rating | Align   |
| :----- | :---: | --------: | ------- |
| Apple  | $1.99 | Excellent | Left    |
| Banana | $0.99 |      Good | Center  |
| Orange | $1.49 |     Great | Right   |
| Grape  | $2.99 |     Sweet | Default |

## 9. Footnote (some platforms)

Word with note[^1].

[^1]: Footnote content here. Multiple lines supported.

## 10. Scratchblocks

<scratchblocks>
when green flag clicked
say [Hello, Scratch!]
</scratchblocks>

Text above the inline block.

Here's a <sb>show</sb> block.

Text below the inline block.

Click <go-to-block main:1.2>here</go-to-block> to jump to the Scratch code block.
