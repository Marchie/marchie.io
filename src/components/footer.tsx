import React from 'react'
import {graphql, Link, StaticQuery} from 'gatsby'
import {styled} from '../styles/theme'

const StyledFooter = styled.footer`
  padding-bottom: 36px;
`

type StaticQueryData = {
  site: {
    siteMetadata: {
      title: string
      author: {
        name: string
      }
    }
  }
}

const Footer: React.FC = () => (
  <StaticQuery
    query={graphql`
      query {
        site {
          siteMetadata {
            title
            author {
              name
            }
          }
        }
      }
    `}
    render={(data: StaticQueryData): React.ReactElement | null => {
      return (
        <StyledFooter className="footer">
          © {new Date().getFullYear()},{` `}
          <Link to={`/`}>
            {data.site.siteMetadata.author.name} / {data.site.siteMetadata.title}
          </Link>
          . Built with
          {` `}
          <a href="https://www.gatsbyjs.org">Gatsby</a>. Inspired by <a href="https://jeffrafter.com">jeffrafter.com</a>
        </StyledFooter>
      )
    }}
  />
)

export default Footer
